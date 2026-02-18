import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

/** Validate a YYYY-MM-DD string and return a Date (UTC midnight) or null.
 *  Checks calendar validity — rejects impossible dates like 2026-02-31
 *  that JavaScript silently rolls forward.
 */
function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(value + "T00:00:00Z");
  if (isNaN(d.getTime())) return null;
  // Verify the parsed components match the input to catch rollover (e.g. Feb 31 -> Mar 3)
  const [year, month, day] = value.split("-").map(Number);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) {
    return null;
  }
  return d;
}

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;
    if (!sessionToken) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const session = parseSessionToken(sessionToken);
    if (!session) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    const project = searchParams.get("project") || null;
    const source = searchParams.get("source") || null;
    const limitParam = searchParams.get("limit");
    const offsetParam = searchParams.get("offset");

    // Validate date params
    if (fromParam && !parseDate(fromParam)) {
      return NextResponse.json({ error: "Invalid 'from' date. Expected YYYY-MM-DD." }, { status: 400 });
    }
    if (toParam && !parseDate(toParam)) {
      return NextResponse.json({ error: "Invalid 'to' date. Expected YYYY-MM-DD." }, { status: 400 });
    }

    // Validate from <= to
    if (fromParam && toParam) {
      const fromDate = parseDate(fromParam)!;
      const toDate = parseDate(toParam)!;
      if (fromDate.getTime() > toDate.getTime()) {
        return NextResponse.json({ error: "'from' date must be <= 'to' date." }, { status: 400 });
      }
    }

    // Default range: last 90 days (all UTC)
    const now = new Date();
    const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 90));

    const from = fromParam ? parseDate(fromParam)! : defaultFrom;

    // Use exclusive upper bound: to < (toDate + 1 day) — avoids setHours timezone skew
    const toDateUTC = toParam
      ? parseDate(toParam)!
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const toExclusive = new Date(toDateUTC.getTime() + 24 * 60 * 60 * 1000);

    // Pagination
    const limit = Math.min(Math.max(parseInt(limitParam ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(parseInt(offsetParam ?? "0", 10) || 0, 0);

    const { drizzle } = await import("drizzle-orm/postgres-js");
    const postgresModule = await import("postgres");
    const schema = await import("@/db/schema");
    const { eq, and, gte, lt, sql } = await import("drizzle-orm");

    const client = postgresModule.default(process.env.DATABASE_URL!);
    const db = drizzle(client, { schema });

    try {
      const conditions = [
        eq(schema.prompts.userId, session.userId),
        sql`${schema.prompts.sessionId} IS NOT NULL`,
        gte(schema.prompts.timestamp, from),
        lt(schema.prompts.timestamp, toExclusive),
      ];

      if (project) conditions.push(eq(schema.prompts.projectName, project));
      if (source) conditions.push(eq(schema.prompts.source, source));

      const whereClause = and(...conditions);

      // Count total sessions for pagination metadata
      const countResult = await db.execute(sql`
        SELECT COUNT(DISTINCT ${schema.prompts.sessionId})::int as total
        FROM ${schema.prompts}
        WHERE ${whereClause}
      `);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const countRows = ((countResult as any).rows ?? countResult) as Record<string, unknown>[];
      const totalCount = Number(countRows[0]?.total ?? 0);

      const sessionsResult = await db.execute(sql`
        SELECT
          ${schema.prompts.sessionId} as session_id,
          MIN(${schema.prompts.timestamp}) as started_at,
          MAX(${schema.prompts.timestamp}) as ended_at,
          COUNT(*)::int as prompt_count,
          (array_agg(${schema.prompts.projectName} ORDER BY ${schema.prompts.timestamp} ASC))[1] as project_name,
          (array_agg(${schema.prompts.source} ORDER BY ${schema.prompts.timestamp} ASC))[1] as source,
          LEFT((array_agg(${schema.prompts.promptText} ORDER BY ${schema.prompts.timestamp} ASC))[1], 100) as first_prompt,
          SUM(COALESCE(${schema.prompts.tokenEstimate}, 0) + COALESCE(${schema.prompts.tokenEstimateResponse}, 0))::int as total_tokens
        FROM ${schema.prompts}
        WHERE ${whereClause}
        GROUP BY ${schema.prompts.sessionId}
        ORDER BY MIN(${schema.prompts.timestamp}) ASC, ${schema.prompts.sessionId} ASC
        LIMIT ${sql.raw(String(limit))}
        OFFSET ${sql.raw(String(offset))}
      `);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = ((sessionsResult as any).rows ?? sessionsResult) as Record<string, unknown>[];

      // Group sessions by day (UTC)
      const dayMap = new Map<string, Array<{
        sessionId: string;
        startedAt: string;
        endedAt: string;
        promptCount: number;
        totalTokens: number;
        projectName: string | null;
        source: string | null;
        firstPrompt: string;
        duration: number;
      }>>();

      for (const row of rows) {
        // Use toISOString() for stable, timezone-safe serialization
        const startDate = new Date(String(row.started_at));
        const endDate = new Date(String(row.ended_at));
        const startedAt = startDate.toISOString();
        const endedAt = endDate.toISOString();
        const dateKey = startedAt.slice(0, 10); // UTC date

        const durationMs = endDate.getTime() - startDate.getTime();
        const durationMinutes = Math.round(durationMs / 60000);

        const sessionData = {
          sessionId: String(row.session_id),
          startedAt,
          endedAt,
          promptCount: Number(row.prompt_count),
          totalTokens: Number(row.total_tokens ?? 0),
          projectName: row.project_name ? String(row.project_name) : null,
          source: row.source ? String(row.source) : null,
          firstPrompt: String(row.first_prompt ?? ""),
          duration: durationMinutes,
        };

        const existing = dayMap.get(dateKey);
        if (existing) {
          existing.push(sessionData);
        } else {
          dayMap.set(dateKey, [sessionData]);
        }
      }

      const days = Array.from(dayMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, sessions]) => ({ date, sessions }));

      return NextResponse.json({
        days,
        pagination: {
          total: totalCount,
          limit,
          offset,
          hasMore: offset + limit < totalCount,
        },
      });
    } finally {
      await client.end();
    }
  } catch (error) {
    console.error("Timeline API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
