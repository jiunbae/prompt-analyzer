import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

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

    // Default range: last 90 days
    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setDate(defaultFrom.getDate() - 90);
    defaultFrom.setUTCHours(0, 0, 0, 0);

    const from = fromParam ? new Date(fromParam) : defaultFrom;
    const to = toParam ? new Date(toParam) : now;

    // Make 'to' inclusive of the whole day
    if (toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam)) {
      to.setHours(23, 59, 59, 999);
    }

    const { drizzle } = await import("drizzle-orm/postgres-js");
    const postgresModule = await import("postgres");
    const schema = await import("@/db/schema");
    const { eq, and, gte, lte, sql } = await import("drizzle-orm");

    const client = postgresModule.default(process.env.DATABASE_URL!);
    const db = drizzle(client, { schema });

    try {
      const conditions = [
        eq(schema.prompts.userId, session.userId),
        sql`${schema.prompts.sessionId} IS NOT NULL`,
        gte(schema.prompts.timestamp, from),
        lte(schema.prompts.timestamp, to),
      ];

      if (project) conditions.push(eq(schema.prompts.projectName, project));
      if (source) conditions.push(eq(schema.prompts.source, source));

      const whereClause = and(...conditions);

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
        ORDER BY MIN(${schema.prompts.timestamp}) ASC
      `);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = ((sessionsResult as any).rows ?? sessionsResult) as Record<string, unknown>[];

      // Group sessions by day
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
        const startedAt = String(row.started_at);
        const endedAt = String(row.ended_at);
        const startDate = new Date(startedAt);
        const dateKey = startDate.toISOString().slice(0, 10);

        const durationMs = new Date(endedAt).getTime() - startDate.getTime();
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

      return NextResponse.json({ days });
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
