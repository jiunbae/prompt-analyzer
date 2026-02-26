import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { desc, sql, eq, and, gte, lt } from "drizzle-orm";
import { computeSessions } from "@/lib/session-analysis";
import { logger } from "@/lib/logger";

export interface AnalyticsData {
  stats: {
    totalPrompts: number;
    totalTokens: number;
    totalChars: number;
    uniqueProjects: number;
    avgPromptLength: number;
  };
  responseStats: {
    totalResponses: number;
    totalResponseTokens: number;
    totalResponseChars: number;
    avgResponseLength: number;
    responseRate: number;
  };
  dailyStats: Array<{ date: string; count: number; tokens: number; inputTokens: number; outputTokens: number }>;
  projectStats: Array<{ project: string | null; count: number; tokens: number }>;
  typeStats: Array<{ type: string | null; count: number }>;
  recentPrompts: Array<{
    id: string;
    timestamp: Date;
    projectName: string | null;
    promptLength: number;
    promptType: string | null;
    hasResponse: boolean;
  }>;
  projectActivity: Array<{ project: string; count: number }>;
  sessions: {
    summary: {
      sessions: number;
      avgPromptsPerSession: number;
      avgSessionMinutes: number;
    };
    perDay: Array<{ date: string; sessions: number }>;
  };
}

export function toDateOnlyString(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function getLastNDays(end: Date, days: number) {
  const base = new Date(end);
  base.setUTCHours(0, 0, 0, 0);

  const result: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    result.push(toDateOnlyString(d));
  }
  return result;
}

export { formatNumber } from "@/lib/format";

export async function getAnalytics(userId: string | null): Promise<AnalyticsData | null> {
  try {
    // Build user filter condition
    const userFilter = userId
      ? eq(schema.prompts.userId, userId)
      : undefined;

    const userProjectFilter = userId
      ? sql`project_name is not null AND user_id = ${userId}`
      : sql`project_name is not null`;

    const rangeTo = new Date();
    const rangeFrom = new Date(rangeTo);
    rangeFrom.setUTCDate(rangeFrom.getUTCDate() - 29);
    rangeFrom.setUTCHours(0, 0, 0, 0);

    const dateExpr = sql<string>`date(${schema.prompts.timestamp})`;

    const rangeWhere = and(
      ...(userFilter ? [userFilter] : []),
      gte(schema.prompts.timestamp, rangeFrom),
      lt(schema.prompts.timestamp, rangeTo),
      eq(schema.prompts.promptType, "user_input")
    );

    const [stats, responseStatsRows, dailySeries, projectStats, typeStats, recentPrompts, projectActivityRows, sessionPromptRows] =
      await Promise.all([
      // Overall stats - filtered by user
      db
        .select({
          totalPrompts: sql<number>`count(*)`,
          totalTokens: sql<number>`coalesce(sum(token_estimate), 0)`,
          totalChars: sql<number>`coalesce(sum(prompt_length), 0)`,
          uniqueProjects: sql<number>`count(distinct project_name)`,
          avgPromptLength: sql<number>`avg(prompt_length)`,
        })
        .from(schema.prompts)
        .where(userFilter),

      // Response stats - filtered by user
      db
        .select({
          totalResponses: sql<number>`count(response_text)`,
          totalResponseTokens: sql<number>`coalesce(sum(token_estimate_response), 0)`,
          totalResponseChars: sql<number>`coalesce(sum(response_length), 0)`,
          avgResponseLength: sql<number>`coalesce(avg(response_length), 0)`,
          totalRows: sql<number>`count(*)`,
        })
        .from(schema.prompts)
        .where(userFilter),

      db
        .select({
          date: dateExpr,
          count: sql<number>`count(*)`,
          tokens: sql<number>`coalesce(sum(coalesce(token_estimate, 0) + coalesce(token_estimate_response, 0)), 0)`,
          inputTokens: sql<number>`coalesce(sum(coalesce(token_estimate, 0)), 0)`,
          outputTokens: sql<number>`coalesce(sum(coalesce(token_estimate_response, 0)), 0)`,
        })
        .from(schema.prompts)
        .where(rangeWhere)
        .groupBy(dateExpr)
        .orderBy(dateExpr),

      // Top projects - filtered by user
      db
        .select({
          project: schema.prompts.projectName,
          count: sql<number>`count(*)`,
          tokens: sql<number>`coalesce(sum(token_estimate), 0)`,
        })
        .from(schema.prompts)
        .where(userProjectFilter)
        .groupBy(schema.prompts.projectName)
        .orderBy(desc(sql`count(*)`))
        .limit(10),

      // Prompt types distribution - filtered by user
      db
        .select({
          type: schema.prompts.promptType,
          count: sql<number>`count(*)`,
        })
        .from(schema.prompts)
        .where(userFilter)
        .groupBy(schema.prompts.promptType),

      // Recent activity (last 5 prompts) - filtered by user
      db
        .select({
          id: schema.prompts.id,
          timestamp: schema.prompts.timestamp,
          projectName: schema.prompts.projectName,
          promptLength: schema.prompts.promptLength,
          promptType: schema.prompts.promptType,
          hasResponse: sql<boolean>`response_text is not null`,
        })
        .from(schema.prompts)
        .where(userFilter)
        .orderBy(desc(schema.prompts.timestamp))
        .limit(5),

      // Project activity (last 30d, user_input only)
      db
        .select({
          project: schema.prompts.projectName,
          count: sql<number>`count(*)`,
        })
        .from(schema.prompts)
        .where(and(rangeWhere, sql`project_name is not null`))
        .groupBy(schema.prompts.projectName)
        .orderBy(desc(sql`count(*)`))
        .limit(10),

      // Sessions (last 30d, user_input only)
      db
        .select({
          timestamp: schema.prompts.timestamp,
        })
        .from(schema.prompts)
        .where(rangeWhere)
        .orderBy(schema.prompts.timestamp),
    ]);

    // Fill last 30d daily series (even if some days have no data)
    const dayKeys = getLastNDays(rangeTo, 30);
    const dailyMap = new Map(
      dailySeries.map((d) => [d.date, {
        count: Number(d.count ?? 0),
        tokens: Number(d.tokens ?? 0),
        inputTokens: Number(d.inputTokens ?? 0),
        outputTokens: Number(d.outputTokens ?? 0),
      }])
    );

    const dailyStats = dayKeys.map((date) => ({
      date,
      count: dailyMap.get(date)?.count ?? 0,
      tokens: dailyMap.get(date)?.tokens ?? 0,
      inputTokens: dailyMap.get(date)?.inputTokens ?? 0,
      outputTokens: dailyMap.get(date)?.outputTokens ?? 0,
    }));

    // Session analysis (30-minute gap heuristic)
    const sessions = computeSessions(sessionPromptRows);

    const sessionsCount = sessions.length;
    const totalSessionPrompts = sessions.reduce((acc, s) => acc + s.promptCount, 0);
    const totalSessionMinutes = sessions.reduce(
      (acc, s) => acc + (s.end.getTime() - s.start.getTime()) / 60000,
      0
    );

    const sessionSummary = {
      sessions: sessionsCount,
      avgPromptsPerSession: sessionsCount ? Math.round(totalSessionPrompts / sessionsCount) : 0,
      avgSessionMinutes: sessionsCount ? Math.round(totalSessionMinutes / sessionsCount) : 0,
    };

    const sessionsPerDayMap = new Map<string, number>();
    for (const s of sessions) {
      const day = toDateOnlyString(s.start);
      sessionsPerDayMap.set(day, (sessionsPerDayMap.get(day) ?? 0) + 1);
    }

    const sessionsPerDay = dayKeys.map((date) => ({
      date,
      sessions: sessionsPerDayMap.get(date) ?? 0,
    }));

    const rRow = responseStatsRows[0];
    const totalRows = Number(rRow?.totalRows ?? 0);
    const totalResponses = Number(rRow?.totalResponses ?? 0);

    const responseStats = {
      totalResponses,
      totalResponseTokens: Number(rRow?.totalResponseTokens ?? 0),
      totalResponseChars: Number(rRow?.totalResponseChars ?? 0),
      avgResponseLength: Math.round(Number(rRow?.avgResponseLength ?? 0)),
      responseRate: totalRows > 0 ? Math.round((totalResponses / totalRows) * 100) : 0,
    };

    return {
      stats: stats[0],
      responseStats,
      dailyStats,
      projectStats,
      typeStats,
      recentPrompts,
      projectActivity: projectActivityRows.map((p) => ({
        project: p.project ?? "No project",
        count: Number(p.count ?? 0),
      })),
      sessions: {
        summary: sessionSummary,
        perDay: sessionsPerDay,
      },
    };
  } catch (error) {
    logger.error({ err: error, userId }, "Failed to load analytics data");
    throw error;
  }
}
