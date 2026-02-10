import { env } from "@/env";
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

let db: any = null;
let promptsTable: any = null;

async function getDb() {
  if (!db) {
    const postgres = (await import("postgres")).default;
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const schema = await import("@/db/schema");

    const connectionString = env.DATABASE_URL;
    const client = postgres(connectionString);
    db = drizzle(client, { schema });
    promptsTable = schema.prompts;
  }
  return { db, promptsTable };
}

export async function updateDailyAnalytics(dateStr: string) {
  const { db } = await getDb();
  const schema = await import("@/db/schema");
  const { eq, sql } = await import("drizzle-orm");

  const [stats] = await db
    .select({
      count: sql<number>`count(*)`,
      totalChars: sql<number>`sum(prompt_length + coalesce(response_length, 0))`,
      totalTokens: sql<number>`sum(token_estimate + coalesce(token_estimate_response, 0))`,
      uniqueProjects: sql<number>`count(distinct project_name)`,
    })
    .from(schema.prompts)
    .where(sql`date(timestamp) = ${dateStr}`);

  if (stats) {
    const avgLength = stats.count > 0 ? Number(stats.totalChars) / stats.count : 0;

    await db
      .insert(schema.analyticsDaily)
      .values({
        date: dateStr,
        promptCount: Number(stats.count),
        totalChars: Number(stats.totalChars),
        totalTokensEst: Number(stats.totalTokens),
        uniqueProjects: Number(stats.uniqueProjects),
        avgPromptLength: String(avgLength.toFixed(2)),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.analyticsDaily.date,
        set: {
          promptCount: Number(stats.count),
          totalChars: Number(stats.totalChars),
          totalTokensEst: Number(stats.totalTokens),
          uniqueProjects: Number(stats.uniqueProjects),
          avgPromptLength: String(avgLength.toFixed(2)),
          updatedAt: new Date(),
        },
      });
  }
}

export async function findUserByToken(token: string) {
  const { db } = await getDb();
  const { eq } = await import("drizzle-orm");
  const schema = await import("@/db/schema");

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.token, token))
    .limit(1);

  return user ?? null;
}
