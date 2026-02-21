import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireAuth, AuthError } from "@/lib/with-auth";
import * as schema from "@/db/schema";
import { eq, and, gte, lt, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** Validate a YYYY-MM-DD string and return a Date (UTC midnight) or null.
 *  Checks calendar validity — rejects impossible dates like 2026-02-31
 *  that JavaScript silently rolls forward.
 */
function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(value + "T00:00:00Z");
  if (isNaN(d.getTime())) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) {
    return null;
  }
  return d;
}

/**
 * Lightweight endpoint that returns {date, count}[] for the full date range.
 * No session details, no pagination — just day-level session counts for the calendar heatmap.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();

    const { searchParams } = new URL(request.url);
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    const project = searchParams.get("project") || null;
    const source = searchParams.get("source") || null;

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

    const toDateUTC = toParam
      ? parseDate(toParam)!
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const toExclusive = new Date(toDateUTC.getTime() + 24 * 60 * 60 * 1000);

    const conditions = [
      eq(schema.prompts.userId, session.userId),
      sql`${schema.prompts.sessionId} IS NOT NULL`,
      gte(schema.prompts.timestamp, from),
      lt(schema.prompts.timestamp, toExclusive),
    ];

    if (project) conditions.push(eq(schema.prompts.projectName, project));
    if (source) conditions.push(eq(schema.prompts.source, source));

    const whereClause = and(...conditions);

    // Get per-day distinct session counts — no session details, no pagination
    const result = await db.execute(sql`
      SELECT
        (MIN(${schema.prompts.timestamp}) AT TIME ZONE 'UTC')::date::text as date,
        COUNT(DISTINCT ${schema.prompts.sessionId})::int as count
      FROM ${schema.prompts}
      WHERE ${whereClause}
      GROUP BY ${schema.prompts.sessionId}
    `);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = ((result as any).rows ?? result) as Record<string, unknown>[];

    // Aggregate by date (a session's date is based on its first prompt's UTC date)
    const dayMap = new Map<string, number>();
    for (const row of rows) {
      const date = String(row.date);
      dayMap.set(date, (dayMap.get(date) ?? 0) + Number(row.count));
    }

    const days = Array.from(dayMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, count]) => ({ date, count }));

    return NextResponse.json({ days });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("Calendar API error:", error);
    return NextResponse.json(
      { error: "Failed to load calendar data" },
      { status: 500 }
    );
  }
}
