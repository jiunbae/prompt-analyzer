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

interface DailyStats {
  totalPrompts: number;
  totalTokens: number;
  uniqueProjects: number;
  uniqueSessions: number;
  peakHour: number;
  peakHourCount: number;
  mostActiveProject: string | null;
  mostActiveProjectCount: number;
  avgPromptLength: number;
  totalResponseTokens: number;
}

async function queryDailyStats(
  userId: string,
  from: Date,
  to: Date,
): Promise<DailyStats> {
  const whereClause = and(
    eq(schema.prompts.userId, userId),
    gte(schema.prompts.timestamp, from),
    lt(schema.prompts.timestamp, to),
  );

  const [overview, hourly, projects] = await Promise.all([
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
        hour: sql<number>`extract(hour from ${schema.prompts.timestamp})`,
        count: sql<number>`count(*)`,
      })
      .from(schema.prompts)
      .where(whereClause)
      .groupBy(sql`extract(hour from ${schema.prompts.timestamp})`)
      .orderBy(sql`count(*) DESC`)
      .limit(1),

    db
      .select({
        project: schema.prompts.projectName,
        count: sql<number>`count(*)`,
      })
      .from(schema.prompts)
      .where(and(whereClause, sql`project_name IS NOT NULL`))
      .groupBy(schema.prompts.projectName)
      .orderBy(sql`count(*) DESC`)
      .limit(1),
  ]);

  const row = overview[0];
  const peakRow = hourly[0];
  const topProject = projects[0];

  return {
    totalPrompts: Number(row?.totalPrompts ?? 0),
    totalTokens: Number(row?.totalTokens ?? 0),
    totalResponseTokens: Number(row?.totalResponseTokens ?? 0),
    uniqueProjects: Number(row?.uniqueProjects ?? 0),
    uniqueSessions: Number(row?.uniqueSessions ?? 0),
    peakHour: Number(peakRow?.hour ?? 0),
    peakHourCount: Number(peakRow?.count ?? 0),
    mostActiveProject: topProject?.project ?? null,
    mostActiveProjectCount: Number(topProject?.count ?? 0),
    avgPromptLength: Math.round(Number(row?.avgPromptLength ?? 0)),
  };
}

function formatHour(hour: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${display}${suffix}`;
}

function buildStatsOnlyInsight(stats: DailyStats): InsightResult {
  const highlights: InsightHighlight[] = [
    { label: "Total Prompts", value: stats.totalPrompts },
    { label: "Input Tokens", value: stats.totalTokens },
    { label: "Output Tokens", value: stats.totalResponseTokens },
    { label: "Unique Projects", value: stats.uniqueProjects },
    { label: "Sessions", value: stats.uniqueSessions },
    { label: "Peak Hour", value: formatHour(stats.peakHour) },
    { label: "Avg Prompt Length", value: `${stats.avgPromptLength} chars` },
  ];

  if (stats.mostActiveProject) {
    highlights.push({
      label: "Most Active Project",
      value: `${stats.mostActiveProject} (${stats.mostActiveProjectCount} prompts)`,
    });
  }

  const summaryParts: string[] = [];
  summaryParts.push(
    `You made ${stats.totalPrompts} prompt${stats.totalPrompts !== 1 ? "s" : ""} today`,
  );
  if (stats.uniqueProjects > 0) {
    summaryParts.push(
      `across ${stats.uniqueProjects} project${stats.uniqueProjects !== 1 ? "s" : ""}`,
    );
  }
  if (stats.uniqueSessions > 0) {
    summaryParts.push(
      `in ${stats.uniqueSessions} session${stats.uniqueSessions !== 1 ? "s" : ""}`,
    );
  }
  summaryParts.push(
    `using approximately ${stats.totalTokens + stats.totalResponseTokens} tokens total.`,
  );
  if (stats.peakHourCount > 0) {
    summaryParts.push(
      `Your most active hour was ${formatHour(stats.peakHour)} with ${stats.peakHourCount} prompts.`,
    );
  }
  if (stats.mostActiveProject) {
    summaryParts.push(
      `Top project: ${stats.mostActiveProject} (${stats.mostActiveProjectCount} prompts).`,
    );
  }

  return {
    title: "Daily Summary",
    summary: summaryParts.join(" "),
    highlights,
    confidence: 0.9,
    generatedAt: new Date().toISOString(),
  };
}

export async function handler(input: ProcessorInput): Promise<InsightResult> {
  const fromDate = new Date(input.dateRange.from);
  const toDate = new Date(input.dateRange.to);

  // If "from" and "to" are the same day (date string), extend "to" to end of that day
  if (input.dateRange.from === input.dateRange.to) {
    toDate.setUTCDate(toDate.getUTCDate() + 1);
  }

  // If no explicit range, default to today
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setUTCDate(tomorrowStart.getUTCDate() + 1);

  const from = Number.isNaN(fromDate.getTime()) ? todayStart : fromDate;
  const to = Number.isNaN(toDate.getTime()) ? tomorrowStart : toDate;

  const stats = await queryDailyStats(input.userId, from, to);

  // If no prompts at all, return a minimal result
  if (stats.totalPrompts === 0) {
    return {
      title: "Daily Summary",
      summary: "No prompt activity found for this period. Start prompting to see your daily summary!",
      highlights: [{ label: "Total Prompts", value: 0 }],
      confidence: 1,
      generatedAt: new Date().toISOString(),
    };
  }

  // If LLM is not configured, return stats-only insight
  const llmConfig = getLLMConfig();
  if (!llmConfig) {
    return buildStatsOnlyInsight(stats);
  }

  // Build LLM prompt
  const statsJson = JSON.stringify(stats, null, 2);
  const systemPrompt = `You are an AI assistant that generates concise daily activity summaries for a developer prompt tracking tool called "Oh My Prompt". You analyze prompt usage statistics and generate insightful, natural-language summaries.

Always respond with valid JSON matching this exact schema:
{
  "title": "string - brief title for the daily summary",
  "summary": "string - 2-3 sentence natural language summary with trends and highlights",
  "highlights": [{"label": "string", "value": "string or number"}],
  "trends": [{"metric": "string", "direction": "up|down|stable", "magnitude": number (0-100), "explanation": "string"}],
  "recommendations": ["string - actionable tip based on the data"],
  "confidence": number (0-1)
}`;

  const userPrompt = `Here are today's prompt activity statistics for a user:

${statsJson}

Date range: ${input.dateRange.from} to ${input.dateRange.to}

Generate a daily summary insight. Focus on:
1. A brief, engaging summary of the day's activity
2. Key highlights (most interesting data points)
3. Any notable trends or patterns (e.g., peak productivity hours)
4. 1-2 actionable recommendations

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

    // Validate required fields and build result
    const result: InsightResult = {
      title: typeof parsed.title === "string" ? parsed.title : "Daily Summary",
      summary:
        typeof parsed.summary === "string"
          ? parsed.summary
          : buildStatsOnlyInsight(stats).summary,
      highlights: Array.isArray(parsed.highlights)
        ? parsed.highlights.filter(
            (h: unknown): h is InsightHighlight =>
              typeof h === "object" &&
              h !== null &&
              "label" in h &&
              "value" in h,
          )
        : buildStatsOnlyInsight(stats).highlights,
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
        : undefined,
      recommendations: Array.isArray(parsed.recommendations)
        ? parsed.recommendations.filter(
            (r: unknown): r is string => typeof r === "string",
          )
        : undefined,
      confidence:
        typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.8,
      generatedAt: new Date().toISOString(),
    };

    return result;
  } catch (error) {
    logger.error({ err: error }, "Daily summary LLM error");
    // Fall back to stats-only on LLM failure
    const fallback = buildStatsOnlyInsight(stats);
    fallback.recommendations = [
      "AI-enhanced summary unavailable. Check your LLM configuration.",
    ];
    return fallback;
  }
}
