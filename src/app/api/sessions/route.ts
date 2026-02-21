import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireAuth, AuthError } from "@/lib/with-auth";
import * as schema from "@/db/schema";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();

    const { searchParams } = new URL(request.url);
    const project = searchParams.get("project") || null;
    const source = searchParams.get("source") || null;
    const from = searchParams.get("from") || null;
    const to = searchParams.get("to") || null;
    const page = parseInt(searchParams.get("page") ?? "1", 10);
    const pageSize = 20;
    const offset = (page - 1) * pageSize;

    const conditions = [
      eq(schema.prompts.userId, session.userId),
      sql`${schema.prompts.sessionId} IS NOT NULL`,
    ];

    if (project) conditions.push(eq(schema.prompts.projectName, project));
    if (source) conditions.push(eq(schema.prompts.source, source));
    if (from) conditions.push(gte(schema.prompts.timestamp, new Date(from)));
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.prompts.timestamp, toDate));
    }

    const whereClause = and(...conditions);

    const [sessionsResult, countResult] = await Promise.all([
      db.execute(sql`
        SELECT
          ${schema.prompts.sessionId} as session_id,
          MIN(${schema.prompts.timestamp}) as started_at,
          MAX(${schema.prompts.timestamp}) as ended_at,
          COUNT(*)::int as prompt_count,
          COUNT(${schema.prompts.responseText})::int as response_count,
          (array_agg(${schema.prompts.projectName} ORDER BY ${schema.prompts.timestamp} ASC))[1] as project_name,
          (array_agg(${schema.prompts.source} ORDER BY ${schema.prompts.timestamp} ASC))[1] as source,
          (array_agg(${schema.prompts.deviceName} ORDER BY ${schema.prompts.timestamp} ASC))[1] as device_name,
          LEFT((array_agg(${schema.prompts.promptText} ORDER BY ${schema.prompts.timestamp} ASC))[1], 200) as first_prompt,
          SUM(COALESCE(${schema.prompts.tokenEstimate}, 0) + COALESCE(${schema.prompts.tokenEstimateResponse}, 0))::int as total_tokens
        FROM ${schema.prompts}
        WHERE ${whereClause}
        GROUP BY ${schema.prompts.sessionId}
        ORDER BY MAX(${schema.prompts.timestamp}) DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `),
      db.execute(sql`
        SELECT COUNT(DISTINCT ${schema.prompts.sessionId})::int as count
        FROM ${schema.prompts}
        WHERE ${whereClause}
      `),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sRows = ((sessionsResult as any).rows ?? sessionsResult) as Record<string, unknown>[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cRows = ((countResult as any).rows ?? countResult) as Record<string, unknown>[];

    return NextResponse.json({
      sessions: sRows.map((row) => ({
        sessionId: row.session_id,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        promptCount: row.prompt_count,
        responseCount: row.response_count,
        projectName: row.project_name,
        source: row.source,
        deviceName: row.device_name,
        firstPrompt: row.first_prompt,
        totalTokens: row.total_tokens,
      })),
      totalCount: Number(cRows[0]?.count ?? 0),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("Sessions API error:", error);
    return NextResponse.json(
      { error: "Failed to load sessions" },
      { status: 500 }
    );
  }
}
