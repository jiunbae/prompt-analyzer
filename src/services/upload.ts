import { getMinioClient, PROMPTS_BUCKET, isMinioConfigured } from "@/lib/minio";
import { logger } from "@/lib/logger";
import { env } from "@/env";
import { classifyPrompt, updateDailyAnalytics } from "./sync";

export interface UploadRecord {
  event_id: string;
  created_at: string;
  prompt_text: string;
  response_text?: string | null;
  prompt_length: number;
  response_length?: number | null;
  project?: string | null;
  cwd?: string | null;
  source?: string;
  session_id?: string | null;
  role?: string;
  model?: string | null;
  cli_name?: string;
  cli_version?: string | null;
  token_estimate?: number;
  token_estimate_response?: number | null;
  word_count?: number;
  word_count_response?: number | null;
  content_hash?: string;
}

export interface UploadResult {
  success: boolean;
  accepted: number;
  duplicates: number;
  rejected: number;
  errors: string[];
}

function sanitizeEventId(eventId: string): string {
  // Prevent path traversal: strip directory separators and dot-dot sequences
  return eventId.replace(/[\/\\]/g, "_").replace(/\.\./g, "_");
}

function buildMinioKey(userToken: string, createdAt: string, eventId: string): string {
  const date = new Date(createdAt);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const safeId = sanitizeEventId(eventId);
  return `${userToken}/${yyyy}/${mm}/${dd}/${safeId}.json`;
}

function recordToMinioFormat(record: UploadRecord) {
  return {
    timestamp: record.created_at,
    working_directory: record.cwd || "unknown",
    prompt_length: record.prompt_length,
    prompt: record.prompt_text,
    response: record.response_text || undefined,
    response_length: record.response_length || undefined,
    type: record.response_text ? undefined : "input",
  };
}

export async function processUpload(
  records: UploadRecord[],
  userId: string,
  userToken: string,
): Promise<UploadResult> {
  let accepted = 0;
  let duplicates = 0;
  let rejected = 0;
  const errors: string[] = [];
  const affectedDates = new Set<string>();

  const postgres = (await import("postgres")).default;
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { eq, sql, inArray } = await import("drizzle-orm");
  const schema = await import("@/db/schema");

  const client = postgres(env.DATABASE_URL);
  const db = drizzle(client, { schema });

  try {
    // Pre-build tag cache: collect all unique tags, batch-fetch/insert them
    const allTagNames = new Set<string>();
    for (const record of records) {
      if (record.prompt_text) {
        for (const tag of classifyPrompt(record.prompt_text)) {
          allTagNames.add(tag);
        }
      }
    }

    const tagCache = new Map<string, string>();
    if (allTagNames.size > 0) {
      const tagNameArray = [...allTagNames];
      const existingTags = await db
        .select()
        .from(schema.tags)
        .where(inArray(schema.tags.name, tagNameArray));

      for (const tag of existingTags) {
        tagCache.set(tag.name, tag.id);
      }

      const missingTagNames = tagNameArray.filter((name) => !tagCache.has(name));
      if (missingTagNames.length > 0) {
        const inserted = await db
          .insert(schema.tags)
          .values(missingTagNames.map((name) => ({ name })))
          .onConflictDoNothing()
          .returning();

        for (const tag of inserted) {
          tagCache.set(tag.name, tag.id);
        }

        // Re-fetch any that hit conflict (already existed but weren't in our initial query)
        const stillMissing = missingTagNames.filter((name) => !tagCache.has(name));
        if (stillMissing.length > 0) {
          const refetched = await db
            .select()
            .from(schema.tags)
            .where(inArray(schema.tags.name, stillMissing));
          for (const tag of refetched) {
            tagCache.set(tag.name, tag.id);
          }
        }
      }
    }

    for (const record of records) {
      if (!record.event_id || !record.created_at || !record.prompt_text) {
        rejected++;
        errors.push(`Invalid record: missing required fields (event_id, created_at, prompt_text)`);
        continue;
      }

      const minioKey = buildMinioKey(userToken, record.created_at, record.event_id);
      const dateStr = new Date(record.created_at).toISOString().split("T")[0];

      try {
        // Write to MinIO
        if (isMinioConfigured()) {
          const minioData = JSON.stringify(recordToMinioFormat(record));
          const buffer = Buffer.from(minioData, "utf-8");
          await getMinioClient().putObject(PROMPTS_BUCKET, minioKey, buffer, buffer.length, {
            "Content-Type": "application/json",
          });
        }

        // Insert into PostgreSQL
        const promptType = record.prompt_text.includes("<task-notification>")
          ? "task_notification"
          : record.prompt_text.includes("<system-reminder>")
            ? "system"
            : "user_input";

        const [inserted] = await db
          .insert(schema.prompts)
          .values({
            minioKey,
            timestamp: new Date(record.created_at),
            workingDirectory: record.cwd || "unknown",
            promptLength: record.prompt_length,
            promptText: record.prompt_text,
            responseText: record.response_text || undefined,
            responseLength: record.response_length || undefined,
            projectName: record.project || null,
            promptType,
            userId,
            tokenEstimate: record.token_estimate || Math.ceil(record.prompt_length / 4),
            wordCount: record.word_count || record.prompt_text.split(/\s+/).filter(Boolean).length,
            tokenEstimateResponse: record.token_estimate_response || undefined,
            wordCountResponse: record.word_count_response || undefined,
            searchVector: sql`to_tsvector('english', ${record.prompt_text} || ' ' || ${record.response_text ?? ""})`,
          })
          .onConflictDoNothing({ target: schema.prompts.minioKey })
          .returning();

        if (!inserted) {
          duplicates++;
          continue;
        }

        // Auto-classify with pre-cached tags
        const suggestedTags = classifyPrompt(record.prompt_text);
        for (const tagName of suggestedTags) {
          const tagId = tagCache.get(tagName);
          if (tagId) {
            await db
              .insert(schema.promptTags)
              .values({ promptId: inserted.id, tagId })
              .onConflictDoNothing();
          }
        }

        affectedDates.add(dateStr);
        accepted++;
      } catch (error) {
        rejected++;
        errors.push(`Error processing record ${record.event_id}: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }

    // Update daily analytics for affected dates
    for (const date of affectedDates) {
      try {
        await updateDailyAnalytics(date);
      } catch (error) {
        logger.error({ error, date }, "Failed to update daily analytics");
      }
    }
  } finally {
    await client.end();
  }

  return {
    success: errors.length === 0,
    accepted,
    duplicates,
    rejected,
    errors: errors.slice(0, 10), // Limit error messages
  };
}
