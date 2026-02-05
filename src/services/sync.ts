import { getMinioClient, PROMPTS_BUCKET, isMinioConfigured } from "@/lib/minio";
import { env } from "@/env";
import { logger } from "@/lib/logger";
import { sql } from "drizzle-orm";
import type {
  MinioObjectInfo,
  MinioPrompt,
  ProcessedPrompt,
  PromptMetadata,
  PromptType,
  SyncResult,
} from "./types";

export interface SyncOptions {
  userToken?: string;
  userId?: string;
  syncType?: "manual" | "auto" | "cron";
}

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

export async function listAllObjects(
  bucket: string = PROMPTS_BUCKET,
  prefix?: string
): Promise<MinioObjectInfo[]> {
  if (!isMinioConfigured()) {
    throw new Error("MinIO client is not properly configured");
  }

  const objects: MinioObjectInfo[] = [];

  return new Promise((resolve, reject) => {
    const stream = getMinioClient().listObjectsV2(bucket, prefix, true);

    stream.on("data", (obj: any) => {
      if (obj.name?.endsWith(".json")) {
        objects.push({
          name: obj.name,
          lastModified: obj.lastModified,
          etag: obj.etag,
          size: obj.size,
        });
      }
    });

    stream.on("error", (err: Error) => {
      logger.error({ err }, "Error listing objects");
      reject(err);
    });

    stream.on("end", () => {
      logger.info(`Listed ${objects.length} JSON objects from ${bucket}`);
      resolve(objects);
    });
  });
}

export async function fetchPrompt(
  key: string,
  bucket: string = PROMPTS_BUCKET
): Promise<MinioPrompt | null> {
  if (!isMinioConfigured()) {
    throw new Error("MinIO client is not properly configured");
  }

  try {
    const stream = await getMinioClient().getObject(bucket, key);
    const chunks: Buffer[] = [];

    return new Promise((resolve, reject) => {
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("error", reject);
      stream.on("end", () => {
        try {
          const data = Buffer.concat(chunks).toString("utf-8");
          const prompt = JSON.parse(data) as MinioPrompt;

          const isOutput = key.endsWith("_output.json") || prompt.type === "output";
          const hasWorkingDirectory =
            typeof prompt.working_directory === "string" && prompt.working_directory.length > 0;

          if (
            !prompt.timestamp ||
            (!isOutput && (!hasWorkingDirectory || prompt.prompt_length === undefined || !prompt.prompt)) ||
            (isOutput && !prompt.response)
          ) {
            logger.warn({ key }, "Invalid prompt format");
            resolve(null);
            return;
          }

          if (isOutput && !hasWorkingDirectory) {
            prompt.working_directory = "unknown";
          }

          resolve(prompt);
        } catch (parseError) {
          logger.error({ key, parseError }, "Error parsing JSON from MinIO");
          resolve(null);
        }
      });
    });
  } catch (error) {
    logger.error({ key, error }, "Error fetching prompt from MinIO");
    return null;
  }
}

export function processPrompt(
  minioPrompt: MinioPrompt,
  key: string
): ProcessedPrompt {
  const isOutput = key.endsWith("_output.json") || minioPrompt.type === "output";
  const inputHash = isOutput 
    ? (minioPrompt.input_hash || key.split("/").pop()?.replace("_output.json", ""))
    : undefined;

  const workingDirectory = minioPrompt.working_directory ?? "unknown";
  const metadata = !isOutput && minioPrompt.prompt 
    ? extractMetadata(minioPrompt.prompt, workingDirectory)
    : {
        projectName: extractProjectName(workingDirectory),
        promptType: "user_input" as PromptType,
        tokenEstimate: 0,
        wordCount: 0
      };

  return {
    minioKey: key,
    timestamp: new Date(minioPrompt.timestamp),
    workingDirectory,
    promptLength: minioPrompt.prompt_length ?? 0,
    promptText: minioPrompt.prompt ?? "",
    responseText: minioPrompt.response,
    responseLength: minioPrompt.response_length,
    tokenEstimateResponse: minioPrompt.response ? estimateTokens(minioPrompt.response) : undefined,
    wordCountResponse: minioPrompt.response ? countWords(minioPrompt.response) : undefined,
    isOutput,
    inputHash,
    ...metadata,
  };
}

let db: any = null;
let promptsTable: any = null;
let syncLogTable: any = null;

async function getDb() {
  if (!db) {
    const postgres = (await import("postgres")).default;
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const schema = await import("@/db/schema");

    const connectionString = env.DATABASE_URL;
    const client = postgres(connectionString);
    db = drizzle(client, { schema });
    promptsTable = schema.prompts;
    syncLogTable = schema.minioSyncLog;
  }
  return { db, promptsTable, syncLogTable };
}

export function classifyPrompt(text: string): string[] {
  const tags: string[] = [];
  const lowercase = text.toLowerCase();

  const rules = [
    { tag: "debugging", keywords: ["error", "fix", "bug", "crash", "fails", "investigate"] },
    { tag: "refactoring", keywords: ["refactor", "cleanup", "improve", "optimize", "rewrite"] },
    { tag: "feature", keywords: ["add", "implement", "new", "feature", "create"] },
    { tag: "testing", keywords: ["test", "jest", "vitest", "unit", "e2e", "coverage"] },
    { tag: "database", keywords: ["sql", "db", "query", "migration", "drizzle", "postgres"] },
    { tag: "frontend", keywords: ["ui", "component", "react", "css", "tailwind", "layout"] },
    { tag: "api", keywords: ["trpc", "endpoint", "rest", "route", "handler"] },
    { tag: "documentation", keywords: ["doc", "readme", "comment", "guide"] },
  ];

  for (const rule of rules) {
    if (rule.keywords.some((kw) => lowercase.includes(kw))) {
      tags.push(rule.tag);
    }
  }

  return tags;
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

export async function syncAll(options: SyncOptions): Promise<SyncResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let filesProcessed = 0;
  let filesAdded = 0;
  let filesSkipped = 0;

  if (!options?.userId || !options?.userToken) {
    throw new Error("Authentication required for sync operations");
  }

  const prefix = `${options.userToken}/`;
  let syncLogId: string | undefined;
  const affectedDates = new Set<string>();

  try {
    const { db, promptsTable, syncLogTable } = await getDb();
    const { eq, and, sql } = await import("drizzle-orm");

    const [syncLog] = await db
      .insert(syncLogTable)
      .values({
        status: "running",
        filesProcessed: 0,
        filesAdded: 0,
        filesSkipped: 0,
        userId: options.userId,
        syncType: options.syncType ?? "manual",
      })
      .returning();

    syncLogId = syncLog.id;

    try {
      const objects = await listAllObjects(PROMPTS_BUCKET, prefix);
      const existingPrompts = await db
        .select({ minioKey: promptsTable.minioKey })
        .from(promptsTable)
        .where(eq(promptsTable.userId, options.userId));
      
      const existingKeys = new Set(existingPrompts.map((p: any) => p.minioKey));

      const inputs = objects.filter((obj) => !obj.name.endsWith("_output.json"));
      const outputs = objects.filter((obj) => obj.name.endsWith("_output.json"));

      const schema = await import("@/db/schema");

      for (const obj of inputs) {
        filesProcessed++;
        if (existingKeys.has(obj.name)) {
          filesSkipped++;
          continue;
        }

        try {
          const promptData = await fetchPrompt(obj.name);
          if (!promptData) continue;

          const processed = processPrompt(promptData, obj.name);
          affectedDates.add(processed.timestamp.toISOString().split("T")[0]);
          
          const [newPrompt] = await db
            .insert(promptsTable)
            .values({
              ...processed,
              userId: options.userId,
              searchVector: sql`to_tsvector('english', ${processed.promptText} || ' ' || ${
                processed.responseText ?? ""
              })`,
            })
            .returning();

          const suggestedTags = classifyPrompt(processed.promptText);
          for (const tagName of suggestedTags) {
            let [tag] = await db
              .select()
              .from(schema.tags)
              .where(eq(schema.tags.name, tagName))
              .limit(1);

            if (!tag) {
              [tag] = await db
                .insert(schema.tags)
                .values({ name: tagName })
                .onConflictDoNothing()
                .returning();
              
              if (!tag) {
                [tag] = await db
                  .select()
                  .from(schema.tags)
                  .where(eq(schema.tags.name, tagName))
                  .limit(1);
              }
            }

            if (tag) {
              await db
                .insert(schema.promptTags)
                .values({
                  promptId: newPrompt.id,
                  tagId: tag.id,
                })
                .onConflictDoNothing();
            }
          }

          filesAdded++;
        } catch (error) {
          errors.push(`Error processing input ${obj.name}: ${error}`);
        }
      }

      for (const obj of outputs) {
        filesProcessed++;
        try {
          const promptData = await fetchPrompt(obj.name);
          if (!promptData) continue;

          const processed = processPrompt(promptData, obj.name);
          if (processed.isOutput && processed.inputHash) {
            const inputKey = obj.name.replace("_output.json", ".json");
            const [existing] = await db
              .select()
              .from(promptsTable)
              .where(and(eq(promptsTable.minioKey, inputKey), eq(promptsTable.userId, options.userId)))
              .limit(1);

            if (existing) {
              affectedDates.add(existing.timestamp.toISOString().split("T")[0]);
              await db
                .update(promptsTable)
                .set({
                  responseText: processed.responseText,
                  responseLength: processed.responseLength,
                  tokenEstimateResponse: processed.tokenEstimateResponse,
                  wordCountResponse: processed.wordCountResponse,
                  searchVector: sql`to_tsvector('english', ${existing.promptText} || ' ' || ${
                    processed.responseText ?? ""
                  })`,
                  updatedAt: new Date(),
                })
                .where(eq(promptsTable.id, existing.id));
              filesAdded++;
            } else {
              filesSkipped++;
            }
          }
        } catch (error) {
          errors.push(`Error processing output ${obj.name}: ${error}`);
        }
      }

      await db
        .update(syncLogTable)
        .set({
          status: "completed",
          completedAt: new Date(),
          filesProcessed,
          filesAdded,
          filesSkipped,
        })
        .where(eq(syncLogTable.id, syncLog.id));

      for (const date of affectedDates) {
        await updateDailyAnalytics(date);
      }
    } catch (error) {
      await db
        .update(syncLogTable)
        .set({
          status: "failed",
          completedAt: new Date(),
          filesProcessed,
          filesAdded,
          filesSkipped,
          errorMessage: String(error),
        })
        .where(eq(syncLogTable.id, syncLog.id));
      throw error;
    }
  } catch (error) {
    errors.push(`Sync failed: ${error}`);
  }

  return {
    success: errors.length === 0,
    filesProcessed,
    filesAdded,
    filesSkipped,
    errors,
    duration: Date.now() - startTime,
    syncLogId,
  };
}

export async function syncIncremental(
  since: Date,
  options: SyncOptions
): Promise<SyncResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let filesProcessed = 0;
  let filesAdded = 0;
  let filesSkipped = 0;

  if (!options?.userId || !options?.userToken) {
    throw new Error("Authentication required for sync operations");
  }

  const userPrefix = `${options.userToken}/`;
  let syncLogId: string | undefined;
  const affectedDates = new Set<string>();

  try {
    const { db, promptsTable, syncLogTable } = await getDb();
    const { eq, gte, and, sql } = await import("drizzle-orm");

    const [syncLog] = await db
      .insert(syncLogTable)
      .values({
        status: "running",
        filesProcessed: 0,
        filesAdded: 0,
        filesSkipped: 0,
        userId: options.userId,
        syncType: options.syncType ?? "manual",
      })
      .returning();

    syncLogId = syncLog.id;

    try {
      const datePrefixes = getDatePrefixes(since, new Date());
      const prefixes = datePrefixes.map((dp) => `${userPrefix}${dp}`);
      const allObjects: MinioObjectInfo[] = [];
      for (const prefix of prefixes) {
        const objects = await listAllObjects(PROMPTS_BUCKET, prefix);
        allObjects.push(...objects);
      }

      const existingPrompts = await db
        .select({ minioKey: promptsTable.minioKey })
        .from(promptsTable)
        .where(and(gte(promptsTable.timestamp, since), eq(promptsTable.userId, options.userId)));
      
      const existingKeys = new Set(existingPrompts.map((p: any) => p.minioKey));

      const inputs = allObjects.filter((obj) => !obj.name.endsWith("_output.json"));
      const outputs = allObjects.filter((obj) => obj.name.endsWith("_output.json"));

      for (const obj of inputs) {
        filesProcessed++;
        if (existingKeys.has(obj.name)) {
          filesSkipped++;
          continue;
        }

        try {
          const promptData = await fetchPrompt(obj.name);
          if (!promptData || new Date(promptData.timestamp) < since) continue;

          const processed = processPrompt(promptData, obj.name);
          affectedDates.add(processed.timestamp.toISOString().split("T")[0]);
          await db.insert(promptsTable).values({ ...processed, userId: options.userId });
          filesAdded++;
        } catch (error) {
          errors.push(`Error processing incremental input ${obj.name}: ${error}`);
        }
      }

      for (const obj of outputs) {
        filesProcessed++;
        try {
          const promptData = await fetchPrompt(obj.name);
          if (!promptData) continue;

          const processed = processPrompt(promptData, obj.name);
          if (processed.isOutput && processed.inputHash) {
            const inputKey = obj.name.replace("_output.json", ".json");
            const [existing] = await db
              .select()
              .from(promptsTable)
              .where(and(eq(promptsTable.minioKey, inputKey), eq(promptsTable.userId, options.userId)))
              .limit(1);

            if (existing) {
              affectedDates.add(existing.timestamp.toISOString().split("T")[0]);
              await db
                .update(promptsTable)
                .set({
                  responseText: processed.responseText,
                  responseLength: processed.responseLength,
                  tokenEstimateResponse: processed.tokenEstimateResponse,
                  wordCountResponse: processed.wordCountResponse,
                  searchVector: sql`to_tsvector('english', ${existing.promptText} || ' ' || ${
                    processed.responseText ?? ""
                  })`,
                  updatedAt: new Date(),
                })
                .where(eq(promptsTable.id, existing.id));
              filesAdded++;
            } else {
              filesSkipped++;
            }
          }
        } catch (error) {
          errors.push(`Error processing incremental output ${obj.name}: ${error}`);
        }
      }

      await db
        .update(syncLogTable)
        .set({
          status: "completed",
          completedAt: new Date(),
          filesProcessed,
          filesAdded,
          filesSkipped,
        })
        .where(eq(syncLogTable.id, syncLog.id));

      for (const date of affectedDates) {
        await updateDailyAnalytics(date);
      }
    } catch (error) {
      await db
        .update(syncLogTable)
        .set({
          status: "failed",
          completedAt: new Date(),
          filesProcessed,
          filesAdded,
          filesSkipped,
          errorMessage: String(error),
        })
        .where(eq(syncLogTable.id, syncLog.id));
      throw error;
    }
  } catch (error) {
    errors.push(`Incremental sync failed: ${error}`);
  }

  return {
    success: errors.length === 0,
    filesProcessed,
    filesAdded,
    filesSkipped,
    errors,
    duration: Date.now() - startTime,
    syncLogId,
  };
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

function getDatePrefixes(startDate: Date, endDate: Date): string[] {
  const prefixes: string[] = [];
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);

  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  while (current <= end) {
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, "0");
    const day = String(current.getDate()).padStart(2, "0");
    prefixes.push(`${year}/${month}/${day}/`);
    current.setDate(current.getDate() + 1);
  }

  return prefixes;
}

export async function getLastSyncStatus() {
  try {
    const { db, syncLogTable } = await getDb();
    const { desc } = await import("drizzle-orm");

    const [lastSync] = await db
      .select()
      .from(syncLogTable)
      .orderBy(desc(syncLogTable.startedAt))
      .limit(1);

    if (!lastSync) return null;

    return {
      id: lastSync.id,
      startedAt: lastSync.startedAt,
      completedAt: lastSync.completedAt,
      status: lastSync.status as "running" | "completed" | "failed",
      filesProcessed: lastSync.filesProcessed ?? 0,
      filesAdded: lastSync.filesAdded ?? 0,
      filesSkipped: lastSync.filesSkipped ?? 0,
      errorMessage: lastSync.errorMessage,
    };
  } catch (error) {
    console.error("Error getting last sync status:", error);
    return null;
  }
}

export async function isSyncRunning(): Promise<boolean> {
  try {
    const { db, syncLogTable } = await getDb();
    const { desc } = await import("drizzle-orm");

    const [lastSync] = await db
      .select()
      .from(syncLogTable)
      .orderBy(desc(syncLogTable.startedAt))
      .limit(1);

    return lastSync?.status === "running";
  } catch (error) {
    console.error("Error checking sync status:", error);
    return false;
  }
}
