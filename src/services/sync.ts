import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { sql } from "drizzle-orm";
import type {
  PromptMetadata,
  PromptType,
} from "./types";

export function extractProjectName(dir: string): string | null {
  const patterns = [
    /\/(?:Users|home)\/[^/]+\/workspace\/([^/]+)/,
    /\/(?:Users|home)\/[^/]+\/([^/]+)/,
  ];

  for (const pattern of patterns) {
    const match = dir.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function detectPromptType(prompt: string): PromptType {
  if (prompt.includes("<task-notification>")) return "task_notification";
  if (prompt.includes("<system-reminder>")) return "system";
  return "user_input";
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

export function extractMetadata(
  prompt: string,
  workingDirectory: string
): PromptMetadata {
  return {
    projectName: extractProjectName(workingDirectory),
    promptType: detectPromptType(prompt),
    tokenEstimate: estimateTokens(prompt),
    wordCount: countWords(prompt),
  };
}

export async function updateDailyAnalytics(dateStr: string, userId: string) {
  const { and, eq, sql } = await import("drizzle-orm");

  const [stats] = await db
    .select({
      count: sql<number>`count(*)`,
      totalChars: sql<number>`coalesce(sum(prompt_length + coalesce(response_length, 0)), 0)`,
      totalTokens: sql<number>`coalesce(sum(token_estimate + coalesce(token_estimate_response, 0)), 0)`,
      totalResponseTokens: sql<number>`coalesce(sum(token_estimate_response), 0)`,
      uniqueProjects: sql<number>`count(distinct project_name)`,
    })
    .from(schema.prompts)
    .where(and(sql`date(timestamp) = ${dateStr}`, eq(schema.prompts.userId, userId)));

  if (stats) {
    const avgLength = stats.count > 0 ? Number(stats.totalChars) / stats.count : 0;

    await db
      .insert(schema.analyticsDaily)
      .values({
        userId,
        date: dateStr,
        promptCount: Number(stats.count),
        totalChars: Number(stats.totalChars),
        totalTokensEst: Number(stats.totalTokens),
        totalResponseTokens: Number(stats.totalResponseTokens),
        uniqueProjects: Number(stats.uniqueProjects),
        avgPromptLength: String(avgLength.toFixed(2)),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.analyticsDaily.userId, schema.analyticsDaily.date],
        set: {
          promptCount: Number(stats.count),
          totalChars: Number(stats.totalChars),
          totalTokensEst: Number(stats.totalTokens),
          totalResponseTokens: Number(stats.totalResponseTokens),
          uniqueProjects: Number(stats.uniqueProjects),
          avgPromptLength: String(avgLength.toFixed(2)),
          updatedAt: new Date(),
        },
      });
  }
}

export async function findUserByToken(token: string) {
  const { eq } = await import("drizzle-orm");

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.token, token))
    .limit(1);

  return user ?? null;
}
