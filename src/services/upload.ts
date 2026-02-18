import { logger } from "@/lib/logger";
import { env } from "@/env";
import { refreshDailyAggregations } from "@/lib/analytics-cache";
import type { UploadRecord, UploadResult } from "./upload-types";
import { postprocessUploadRecordForDb } from "./upload-postprocess";
import { computeHeuristicScore } from "@/extensions/prompt-quality/processor";

export type { UploadRecord, UploadResult } from "./upload-types";

function sanitizeEventId(eventId: string): string {
  // Allowlist: only alphanumeric, hyphens, and underscores
  return eventId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function buildEventKey(userToken: string, createdAt: Date, eventId: string): string {
  const yyyy = createdAt.getUTCFullYear();
  const mm = String(createdAt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(createdAt.getUTCDate()).padStart(2, "0");
  const safeId = sanitizeEventId(eventId);
  return `${userToken}/${yyyy}/${mm}/${dd}/${safeId}.json`;
}

export async function processUpload(
  records: UploadRecord[],
  userId: string,
  userToken: string,
  deviceId?: string,
): Promise<UploadResult> {
  let accepted = 0;
  let duplicates = 0;
  let rejected = 0;
  const errors: string[] = [];
  const affectedDates = new Set<string>();

  const postgres = (await import("postgres")).default;
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { sql } = await import("drizzle-orm");
  const schema = await import("@/db/schema");

  const client = postgres(env.DATABASE_URL);
  const db = drizzle(client, { schema });

  try {
    const redactEnabled = process.env.OMP_UPLOAD_REDACT_ENABLED !== "false";
    const redactMask = process.env.OMP_UPLOAD_REDACT_MASK || "[REDACTED]";

    for (const record of records) {
      if (!record.event_id || !record.created_at) {
        rejected++;
        errors.push(`Invalid record: missing required fields (event_id, created_at)`);
        continue;
      }

      if (!record.prompt_text || !record.prompt_text.trim()) {
        duplicates++; // Skip silently, count as duplicate to advance sync state
        continue;
      }

      const createdAt = new Date(record.created_at);
      if (Number.isNaN(createdAt.getTime())) {
        rejected++;
        errors.push(`Invalid record ${record.event_id}: created_at is not a valid date`);
        continue;
      }

      const processed = postprocessUploadRecordForDb(record, {
        redactEnabled,
        redactMask,
      });

      const eventKey = buildEventKey(userToken, createdAt, record.event_id);
      const dateStr = createdAt.toISOString().split("T")[0];

      try {
        // Check if event_key already exists
        const [existing] = await db
          .select({ id: schema.prompts.id })
          .from(schema.prompts)
          .where(sql`${schema.prompts.eventKey} = ${eventKey}`)
          .limit(1);

        const promptType = processed.promptText.includes("<task-notification>")
          ? "task_notification"
          : processed.promptText.includes("<system-reminder>")
            ? "system"
            : "user_input";

        if (existing) {
          // Update response if provided (upsert behavior)
          if (processed.responseText) {
            await db
              .update(schema.prompts)
              .set({
                responseText: processed.responseText,
                responseLength: processed.responseLength,
                tokenEstimateResponse: processed.tokenEstimateResponse,
                wordCountResponse: processed.wordCountResponse,
                updatedAt: sql`now()`,
              })
              .where(sql`${schema.prompts.id} = ${existing.id}`);
            affectedDates.add(dateStr);
          }
          duplicates++;
          continue;
        }

        // Compute heuristic quality score for user_input prompts (fast, no LLM)
        const isUserInput = promptType === "user_input";
        const heuristic = isUserInput
          ? computeHeuristicScore(processed.promptText, {
              hasContext: !!(record.project || record.cwd),
            })
          : null;

        // Insert new record
        await db
          .insert(schema.prompts)
          .values({
            eventKey,
            timestamp: createdAt,
            workingDirectory: record.cwd || "unknown",
            promptLength: processed.promptLength,
            promptText: processed.promptText,
            responseText: processed.responseText,
            responseLength: processed.responseLength,
            projectName: record.project || (record.cwd ? record.cwd.split("/").pop() || null : null),
            promptType,
            userId,
            source: record.source || undefined,
            sessionId: record.session_id || undefined,
            deviceName: deviceId || undefined,
            tokenEstimate: processed.tokenEstimate,
            wordCount: processed.wordCount,
            tokenEstimateResponse: processed.tokenEstimateResponse,
            wordCountResponse: processed.wordCountResponse,
            searchVector: sql`to_tsvector('english', ${processed.promptText} || ' ' || ${processed.responseText ?? ""})`,
            // Inline heuristic enrichment for user_input prompts
            ...(heuristic
              ? {
                  qualityScore: heuristic.qualityScore,
                  topicTags: heuristic.topicTags,
                  enrichedAt: new Date(),
                }
              : {}),
          });

        affectedDates.add(dateStr);
        accepted++;
      } catch (error) {
        rejected++;
        errors.push(`Error processing record ${record.event_id}: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }

    // Refresh daily analytics aggregations for this user
    if (affectedDates.size > 0) {
      try {
        const earliest = [...affectedDates].sort()[0];
        await refreshDailyAggregations(userId, new Date(earliest));
      } catch (error) {
        logger.error({ error }, "Failed to refresh daily analytics aggregations");
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
