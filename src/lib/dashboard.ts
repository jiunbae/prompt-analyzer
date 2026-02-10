import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { eq, and, gte, lt, sql, desc } from "drizzle-orm";

export interface DashboardData {
  today: { prompts: number; tokens: number; sessions: number; projects: number };
  yesterday: { prompts: number; tokens: number; sessions: number; projects: number };
  last7Days: Array<{ date: string; count: number }>;
  recentSessions: Array<{
    sessionId: string;
    firstPrompt: string;
    startedAt: string;
    endedAt: string;
    promptCount: number;
    responseCount: number;
    projectName: string | null;
    source: string | null;
    totalTokens: number;
  }>;
  topProjects: Array<{ project: string; count: number }>;
}

export async function getDashboardData(userId: string): Promise<DashboardData | null> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;

  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  try {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setUTCDate(tomorrowStart.getUTCDate() + 1);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);
    const weekAgoStart = new Date(todayStart);
    weekAgoStart.setUTCDate(weekAgoStart.getUTCDate() - 6);

    const userFilter = eq(schema.prompts.userId, userId);

    const [todayStats, yesterdayStats, dailyCounts, recentSessionsRaw, topProjectsRaw] =
      await Promise.all([
        db.select({
          prompts: sql<number>`count(*)`,
          tokens: sql<number>`coalesce(sum(coalesce(${schema.prompts.tokenEstimate},0) + coalesce(${schema.prompts.tokenEstimateResponse},0)),0)`,
          sessions: sql<number>`count(distinct ${schema.prompts.sessionId})`,
          projects: sql<number>`count(distinct ${schema.prompts.projectName})`,
        })
        .from(schema.prompts)
        .where(and(userFilter, gte(schema.prompts.timestamp, todayStart), lt(schema.prompts.timestamp, tomorrowStart))),

        db.select({
          prompts: sql<number>`count(*)`,
          tokens: sql<number>`coalesce(sum(coalesce(${schema.prompts.tokenEstimate},0) + coalesce(${schema.prompts.tokenEstimateResponse},0)),0)`,
          sessions: sql<number>`count(distinct ${schema.prompts.sessionId})`,
          projects: sql<number>`count(distinct ${schema.prompts.projectName})`,
        })
        .from(schema.prompts)
        .where(and(userFilter, gte(schema.prompts.timestamp, yesterdayStart), lt(schema.prompts.timestamp, todayStart))),

        db.select({
          date: sql<string>`date(${schema.prompts.timestamp})`,
          count: sql<number>`count(*)`,
        })
        .from(schema.prompts)
        .where(and(userFilter, gte(schema.prompts.timestamp, weekAgoStart), lt(schema.prompts.timestamp, tomorrowStart)))
        .groupBy(sql`date(${schema.prompts.timestamp})`)
        .orderBy(sql`date(${schema.prompts.timestamp})`),

        db.execute(sql`
          SELECT
            ${schema.prompts.sessionId} as session_id,
            MIN(${schema.prompts.timestamp}) as started_at,
            MAX(${schema.prompts.timestamp}) as ended_at,
            COUNT(*)::int as prompt_count,
            COUNT(${schema.prompts.responseText})::int as response_count,
            (array_agg(${schema.prompts.projectName} ORDER BY ${schema.prompts.timestamp} ASC))[1] as project_name,
            (array_agg(${schema.prompts.source} ORDER BY ${schema.prompts.timestamp} ASC))[1] as source,
            LEFT((array_agg(${schema.prompts.promptText} ORDER BY ${schema.prompts.timestamp} ASC))[1], 200) as first_prompt,
            SUM(COALESCE(${schema.prompts.tokenEstimate}, 0) + COALESCE(${schema.prompts.tokenEstimateResponse}, 0))::int as total_tokens
          FROM ${schema.prompts}
          WHERE ${schema.prompts.userId} = ${userId} AND ${schema.prompts.sessionId} IS NOT NULL
          GROUP BY ${schema.prompts.sessionId}
          ORDER BY MAX(${schema.prompts.timestamp}) DESC
          LIMIT 3
        `),

        db.select({
          project: schema.prompts.projectName,
          count: sql<number>`count(*)`,
        })
        .from(schema.prompts)
        .where(and(
          userFilter,
          gte(schema.prompts.timestamp, weekAgoStart),
          lt(schema.prompts.timestamp, tomorrowStart),
          sql`${schema.prompts.projectName} IS NOT NULL`,
        ))
        .groupBy(schema.prompts.projectName)
        .orderBy(desc(sql`count(*)`))
        .limit(3),
      ]);

    // Fill 7-day series with zeros for missing days
    const dayKeys: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(todayStart);
      d.setUTCDate(d.getUTCDate() - i);
      dayKeys.push(d.toISOString().slice(0, 10));
    }
    const dailyMap = new Map(dailyCounts.map(d => [d.date, Number(d.count)]));
    const last7Days = dayKeys.map(date => ({ date, count: dailyMap.get(date) ?? 0 }));

    // Parse sessions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sRows = ((recentSessionsRaw as any).rows ?? recentSessionsRaw) as Record<string, unknown>[];
    const recentSessions = sRows.map(r => ({
      sessionId: String(r.session_id),
      firstPrompt: String(r.first_prompt ?? ""),
      startedAt: String(r.started_at),
      endedAt: String(r.ended_at),
      promptCount: Number(r.prompt_count),
      responseCount: Number(r.response_count),
      projectName: r.project_name ? String(r.project_name) : null,
      source: r.source ? String(r.source) : null,
      totalTokens: Number(r.total_tokens ?? 0),
    }));

    return {
      today: {
        prompts: Number(todayStats[0]?.prompts ?? 0),
        tokens: Number(todayStats[0]?.tokens ?? 0),
        sessions: Number(todayStats[0]?.sessions ?? 0),
        projects: Number(todayStats[0]?.projects ?? 0),
      },
      yesterday: {
        prompts: Number(yesterdayStats[0]?.prompts ?? 0),
        tokens: Number(yesterdayStats[0]?.tokens ?? 0),
        sessions: Number(yesterdayStats[0]?.sessions ?? 0),
        projects: Number(yesterdayStats[0]?.projects ?? 0),
      },
      last7Days,
      recentSessions,
      topProjects: topProjectsRaw.map(p => ({
        project: p.project ?? "No project",
        count: Number(p.count),
      })),
    };
  } catch (error) {
    console.error("Dashboard data error:", error);
    return null;
  } finally {
    await client.end();
  }
}
