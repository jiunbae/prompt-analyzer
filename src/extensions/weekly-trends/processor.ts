import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, gte, lt, sql } from "drizzle-orm";
import type {
  ProcessorInput,
  InsightResult,
  InsightHighlight,
  InsightTrend,
} from "../types";
import { callLLM, getLLMConfig } from "../llm";
import { logger } from "@/lib/logger";

interface WeekStats {
  totalPrompts: number;
  totalTokens: number;
  totalResponseTokens: number;
  uniqueProjects: number;
  uniqueSessions: number;
  avgPromptLength: number;
  projects: Array<{ project: string; count: number }>;
  dailyCounts: Array<{ date: string; count: number }>;
}

async function queryWeekStats(
  userId: string,
  from: Date,
  to: Date,
): Promise<WeekStats> {
  const whereClause = and(
    eq(schema.prompts.userId, userId),
    gte(schema.prompts.timestamp, from),
    lt(schema.prompts.timestamp, to),
  );

  const [overview, projects, dailyCounts] = await Promise.all([
    db
      .select({
        totalPrompts: sql<number>`count(*)`,
        totalTokens: sql<number>`coalesce(sum(coalesce(token_estimate, 0)), 0)`,
        totalResponseTokens: sql<number>`coalesce(sum(coalesce(token_estimate_response, 0)), 0)`,
        uniqueProjects: sql<number>`count(distinct project_name)`,
        uniqueSessions: sql<number>`count(distinct session_id)`,
        avgPromptLength: sql<number>`coalesce(avg(prompt_length), 0)`,
      })
      .from(schema.prompts)
      .where(whereClause),

    db
      .select({
        project: schema.prompts.projectName,
        count: sql<number>`count(*)`,
      })
      .from(schema.prompts)
      .where(and(whereClause, sql`project_name IS NOT NULL`))
      .groupBy(schema.prompts.projectName)
      .orderBy(sql`count(*) DESC`)
      .limit(10),

    db
      .select({
        date: sql<string>`date(${schema.prompts.timestamp})`,
        count: sql<number>`count(*)`,
      })
      .from(schema.prompts)
      .where(whereClause)
      .groupBy(sql`date(${schema.prompts.timestamp})`)
      .orderBy(sql`date(${schema.prompts.timestamp})`),
  ]);

  const row = overview[0];

  return {
    totalPrompts: Number(row?.totalPrompts ?? 0),
    totalTokens: Number(row?.totalTokens ?? 0),
    totalResponseTokens: Number(row?.totalResponseTokens ?? 0),
    uniqueProjects: Number(row?.uniqueProjects ?? 0),
    uniqueSessions: Number(row?.uniqueSessions ?? 0),
    avgPromptLength: Math.round(Number(row?.avgPromptLength ?? 0)),
    projects: projects.map((p) => ({
      project: p.project ?? "Unknown",
      count: Number(p.count ?? 0),
    })),
    dailyCounts: dailyCounts.map((d) => ({
      date: d.date,
      count: Number(d.count ?? 0),
    })),
  };
}

function computeDelta(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function trendDirection(
  delta: number,
): "up" | "down" | "stable" {
  if (delta > 5) return "up";
  if (delta < -5) return "down";
  return "stable";
}

function buildStatsOnlyInsight(
  currentWeek: WeekStats,
  previousWeek: WeekStats,
): InsightResult {
  const promptDelta = computeDelta(
    currentWeek.totalPrompts,
    previousWeek.totalPrompts,
  );
  const tokenDelta = computeDelta(
    currentWeek.totalTokens + currentWeek.totalResponseTokens,
    previousWeek.totalTokens + previousWeek.totalResponseTokens,
  );
  const sessionDelta = computeDelta(
    currentWeek.uniqueSessions,
    previousWeek.uniqueSessions,
  );
  const projectDelta = computeDelta(
    currentWeek.uniqueProjects,
    previousWeek.uniqueProjects,
  );

  // Find new projects this week that were not in last week
  const prevProjectNames = new Set(previousWeek.projects.map((p) => p.project));
  const newProjects = currentWeek.projects
    .filter((p) => !prevProjectNames.has(p.project))
    .map((p) => p.project);

  const highlights: InsightHighlight[] = [
    { label: "Prompts This Week", value: currentWeek.totalPrompts },
    { label: "Prompts Last Week", value: previousWeek.totalPrompts },
    {
      label: "WoW Change",
      value: `${promptDelta >= 0 ? "+" : ""}${promptDelta}%`,
    },
    {
      label: "Total Tokens",
      value: currentWeek.totalTokens + currentWeek.totalResponseTokens,
    },
    { label: "Projects", value: currentWeek.uniqueProjects },
    { label: "Sessions", value: currentWeek.uniqueSessions },
  ];

  if (newProjects.length > 0) {
    highlights.push({
      label: "New Projects",
      value: newProjects.slice(0, 3).join(", "),
    });
  }

  const trends: InsightTrend[] = [
    {
      metric: "Prompt Volume",
      direction: trendDirection(promptDelta),
      magnitude: Math.abs(promptDelta),
      explanation: `${currentWeek.totalPrompts} prompts this week vs ${previousWeek.totalPrompts} last week (${promptDelta >= 0 ? "+" : ""}${promptDelta}%)`,
    },
    {
      metric: "Token Usage",
      direction: trendDirection(tokenDelta),
      magnitude: Math.abs(tokenDelta),
      explanation: `Total token usage changed by ${tokenDelta >= 0 ? "+" : ""}${tokenDelta}% week-over-week`,
    },
    {
      metric: "Sessions",
      direction: trendDirection(sessionDelta),
      magnitude: Math.abs(sessionDelta),
      explanation: `${currentWeek.uniqueSessions} sessions this week vs ${previousWeek.uniqueSessions} last week`,
    },
    {
      metric: "Project Diversity",
      direction: trendDirection(projectDelta),
      magnitude: Math.abs(projectDelta),
      explanation: `Worked on ${currentWeek.uniqueProjects} unique projects${newProjects.length > 0 ? `, ${newProjects.length} new` : ""}`,
    },
  ];

  const summaryParts: string[] = [];
  summaryParts.push(
    `This week you made ${currentWeek.totalPrompts} prompts (${promptDelta >= 0 ? "+" : ""}${promptDelta}% vs last week)`,
  );
  summaryParts.push(
    `across ${currentWeek.uniqueProjects} projects and ${currentWeek.uniqueSessions} sessions.`,
  );
  if (newProjects.length > 0) {
    summaryParts.push(
      `New projects: ${newProjects.slice(0, 3).join(", ")}.`,
    );
  }

  const recommendations: string[] = [];
  if (promptDelta < -20) {
    recommendations.push(
      "Your prompt activity dropped significantly. Consider setting a daily prompting goal to maintain momentum.",
    );
  }
  if (currentWeek.uniqueProjects === 1 && previousWeek.uniqueProjects > 1) {
    recommendations.push(
      "You focused on a single project this week. Diversifying can help maintain a broader skill set.",
    );
  }
  if (currentWeek.avgPromptLength < 50) {
    recommendations.push(
      "Your average prompt length is quite short. More detailed prompts often yield better results.",
    );
  }
  if (recommendations.length === 0) {
    recommendations.push(
      "Keep up the great work! Your prompting activity is consistent.",
    );
  }

  return {
    title: "Weekly Trends",
    summary: summaryParts.join(" "),
    highlights,
    trends,
    recommendations,
    confidence: 0.9,
    generatedAt: new Date().toISOString(),
  };
}

export async function handler(input: ProcessorInput): Promise<InsightResult> {
  // Calculate current week and previous week date ranges
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setUTCDate(tomorrowStart.getUTCDate() + 1);

  // Current week: from 7 days ago to now
  const currentWeekFrom = new Date(todayStart);
  currentWeekFrom.setUTCDate(currentWeekFrom.getUTCDate() - 6);

  // Previous week: 14 days ago to 7 days ago
  const previousWeekFrom = new Date(todayStart);
  previousWeekFrom.setUTCDate(previousWeekFrom.getUTCDate() - 13);
  const previousWeekTo = new Date(todayStart);
  previousWeekTo.setUTCDate(previousWeekTo.getUTCDate() - 6);

  // If the caller provided an explicit date range, use it for the current week
  // and compute the previous week relative to it
  const inputFrom = new Date(input.dateRange.from);
  const inputTo = new Date(input.dateRange.to);
  let cwFrom = currentWeekFrom;
  let cwTo = tomorrowStart;
  let pwFrom = previousWeekFrom;
  let pwTo = previousWeekTo;

  if (!Number.isNaN(inputFrom.getTime()) && !Number.isNaN(inputTo.getTime())) {
    cwFrom = inputFrom;
    cwTo = inputTo;
    // Compute the duration and use same duration for previous period
    const durationMs = cwTo.getTime() - cwFrom.getTime();
    pwTo = new Date(cwFrom.getTime());
    pwFrom = new Date(cwFrom.getTime() - durationMs);
  }

  const [currentWeek, previousWeek] = await Promise.all([
    queryWeekStats(input.userId, cwFrom, cwTo),
    queryWeekStats(input.userId, pwFrom, pwTo),
  ]);

  // If no activity at all in both weeks
  if (currentWeek.totalPrompts === 0 && previousWeek.totalPrompts === 0) {
    return {
      title: "Weekly Trends",
      summary:
        "No prompt activity found for the current or previous week. Start prompting to see weekly trends!",
      highlights: [
        { label: "Prompts This Week", value: 0 },
        { label: "Prompts Last Week", value: 0 },
      ],
      confidence: 1,
      generatedAt: new Date().toISOString(),
    };
  }

  // If LLM is not configured, return stats-only insight
  const llmConfig = getLLMConfig();
  if (!llmConfig) {
    return buildStatsOnlyInsight(currentWeek, previousWeek);
  }

  // Build LLM prompt
  const dataPayload = JSON.stringify(
    {
      currentWeek: {
        ...currentWeek,
        dateRange: { from: cwFrom.toISOString(), to: cwTo.toISOString() },
      },
      previousWeek: {
        ...previousWeek,
        dateRange: { from: pwFrom.toISOString(), to: pwTo.toISOString() },
      },
      deltas: {
        promptCountDelta: computeDelta(
          currentWeek.totalPrompts,
          previousWeek.totalPrompts,
        ),
        tokenDelta: computeDelta(
          currentWeek.totalTokens + currentWeek.totalResponseTokens,
          previousWeek.totalTokens + previousWeek.totalResponseTokens,
        ),
        sessionDelta: computeDelta(
          currentWeek.uniqueSessions,
          previousWeek.uniqueSessions,
        ),
        projectDelta: computeDelta(
          currentWeek.uniqueProjects,
          previousWeek.uniqueProjects,
        ),
      },
    },
    null,
    2,
  );

  const systemPrompt = `You are an AI assistant that generates weekly trend analysis for a developer prompt tracking tool called "Oh My Prompt". You compare week-over-week metrics and provide actionable insights.

Always respond with valid JSON matching this exact schema:
{
  "title": "string - brief title for the weekly trends",
  "summary": "string - 2-4 sentence narrative summary of the week's trends",
  "highlights": [{"label": "string", "value": "string or number"}],
  "trends": [{"metric": "string", "direction": "up|down|stable", "magnitude": number (0-100), "explanation": "string"}],
  "recommendations": ["string - actionable recommendation based on trends"],
  "confidence": number (0-1)
}`;

  const userPrompt = `Here is the week-over-week prompt activity data:

${dataPayload}

Generate a weekly trends insight. Focus on:
1. A narrative summary comparing this week to last week
2. Key highlights (most significant changes)
3. Clear trends with direction and magnitude
4. 2-3 actionable recommendations based on the trends

Respond ONLY with valid JSON.`;

  try {
    const response = await callLLM(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      llmConfig,
    );

    // Parse the LLM response — extract JSON from possible markdown fences
    let content = response.content.trim();
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      content = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(content);

    const fallback = buildStatsOnlyInsight(currentWeek, previousWeek);

    const result: InsightResult = {
      title:
        typeof parsed.title === "string" ? parsed.title : "Weekly Trends",
      summary:
        typeof parsed.summary === "string" ? parsed.summary : fallback.summary,
      highlights: Array.isArray(parsed.highlights)
        ? parsed.highlights.filter(
            (h: unknown): h is InsightHighlight =>
              typeof h === "object" &&
              h !== null &&
              "label" in h &&
              "value" in h,
          )
        : fallback.highlights,
      trends: Array.isArray(parsed.trends)
        ? parsed.trends.filter(
            (t: unknown): t is InsightTrend =>
              typeof t === "object" &&
              t !== null &&
              "metric" in t &&
              "direction" in t &&
              "magnitude" in t &&
              "explanation" in t,
          )
        : fallback.trends,
      recommendations: Array.isArray(parsed.recommendations)
        ? parsed.recommendations.filter(
            (r: unknown): r is string => typeof r === "string",
          )
        : fallback.recommendations,
      confidence:
        typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.8,
      generatedAt: new Date().toISOString(),
    };

    return result;
  } catch (error) {
    logger.error({ err: error }, "Weekly trends LLM error");
    const fallback = buildStatsOnlyInsight(currentWeek, previousWeek);
    fallback.recommendations = [
      ...(fallback.recommendations ?? []),
      "AI-enhanced analysis unavailable. Check your LLM configuration.",
    ];
    return fallback;
  }
}
