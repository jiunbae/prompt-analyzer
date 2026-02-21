import { logger } from "@/lib/logger";
import { refreshDailyAggregations } from "@/lib/analytics-cache";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import type { UploadRecord, UploadResult } from "./upload-types";
import { postprocessUploadRecordForDb } from "./upload-postprocess";
import { computeHeuristicScore } from "@/extensions/prompt-quality/processor";
import { sql, inArray } from "drizzle-orm";

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

/** A validated+processed record ready for DB insert or duplicate-update. */
interface PreparedRecord {
  eventKey: string;
  dateStr: string;
  createdAt: Date;
  record: UploadRecord;
  processed: ReturnType<typeof postprocessUploadRecordForDb>;
  promptType: string;
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

  const redactEnabled = process.env.OMP_UPLOAD_REDACT_ENABLED !== "false";
  const redactMask = process.env.OMP_UPLOAD_REDACT_MASK || "[REDACTED]";

  // ── Phase 1: Validate & prepare all records in memory ──────────

  const prepared: PreparedRecord[] = [];

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

    const promptType = processed.promptText.includes("<task-notification>")
      ? "task_notification"
      : processed.promptText.includes("<system-reminder>")
        ? "system"
        : "user_input";

    prepared.push({ eventKey, dateStr, createdAt, record, processed, promptType });
  }

  if (prepared.length === 0) {
    return {
      success: errors.length === 0,
      accepted,
      duplicates,
      rejected,
      errors: errors.slice(0, 10),
    };
  }

  // ── Phase 2: Batch-fetch existing eventKeys ────────────────────

  const allEventKeys = prepared.map((p) => p.eventKey);

  // Query in chunks of 500 to avoid overly-large IN clauses
  const QUERY_CHUNK = 500;
  const existingMap = new Map<string, string>(); // eventKey -> prompt id

  for (let i = 0; i < allEventKeys.length; i += QUERY_CHUNK) {
    const chunk = allEventKeys.slice(i, i + QUERY_CHUNK);
    const rows = await db
      .select({ id: schema.prompts.id, eventKey: schema.prompts.eventKey })
      .from(schema.prompts)
      .where(inArray(schema.prompts.eventKey, chunk));

    for (const row of rows) {
      existingMap.set(row.eventKey, row.id);
    }
  }

  // ── Phase 3: Separate new inserts vs. duplicate updates ────────

  const toInsert: PreparedRecord[] = [];
  const toUpdate: Array<PreparedRecord & { existingId: string }> = [];

  for (const item of prepared) {
    const existingId = existingMap.get(item.eventKey);
    if (existingId) {
      toUpdate.push({ ...item, existingId });
    } else {
      toInsert.push(item);
    }
  }

  // ── Phase 4: Batch-update duplicates that have new response data ──

  // For duplicates with a response, update them in parallel (small batches)
  const UPDATE_BATCH = 100;
  const updatesWithResponse = toUpdate.filter((u) => u.processed.responseText);

  for (let i = 0; i < updatesWithResponse.length; i += UPDATE_BATCH) {
    const batch = updatesWithResponse.slice(i, i + UPDATE_BATCH);
    await Promise.all(
      batch.map((item) =>
        db
          .update(schema.prompts)
          .set({
            responseText: item.processed.responseText,
            responseLength: item.processed.responseLength,
            tokenEstimateResponse: item.processed.tokenEstimateResponse,
            wordCountResponse: item.processed.wordCountResponse,
            updatedAt: sql`now()`,
          })
          .where(sql`${schema.prompts.id} = ${item.existingId}`),
      ),
    );
    for (const item of batch) {
      affectedDates.add(item.dateStr);
    }
  }

  duplicates += toUpdate.length;

  // ── Phase 5: Batch-insert new records ──────────────────────────

  if (toInsert.length > 0) {
    // Compute heuristic scores in memory first
    const insertValues = toInsert.map((item) => {
      const isUserInput = item.promptType === "user_input";
      const heuristic = isUserInput
        ? computeHeuristicScore(item.processed.promptText, {
            hasContext: !!(item.record.project || item.record.cwd),
          })
        : null;

      return {
        eventKey: item.eventKey,
        timestamp: item.createdAt,
        workingDirectory: item.record.cwd || "unknown",
        promptLength: item.processed.promptLength,
        promptText: item.processed.promptText,
        responseText: item.processed.responseText,
        responseLength: item.processed.responseLength,
        projectName:
          item.record.project ||
          (item.record.cwd ? item.record.cwd.split("/").pop() || null : null),
        promptType: item.promptType,
        userId,
        source: item.record.source || undefined,
        sessionId: item.record.session_id || undefined,
        deviceName: deviceId || undefined,
        tokenEstimate: item.processed.tokenEstimate,
        wordCount: item.processed.wordCount,
        tokenEstimateResponse: item.processed.tokenEstimateResponse,
        wordCountResponse: item.processed.wordCountResponse,
        searchVector: sql`to_tsvector('english', ${item.processed.promptText} || ' ' || ${item.processed.responseText ?? ""})`,
        // Inline heuristic enrichment for user_input prompts
        ...(heuristic
          ? {
              qualityScore: heuristic.qualityScore,
              topicTags: heuristic.topicTags,
              enrichedAt: new Date(),
            }
          : {}),
      };
    });

    // Insert in chunks to avoid overly large statements
    const INSERT_CHUNK = 200;
    for (let i = 0; i < insertValues.length; i += INSERT_CHUNK) {
      const chunk = insertValues.slice(i, i + INSERT_CHUNK);
      try {
        await db
          .insert(schema.prompts)
          .values(chunk)
          .onConflictDoNothing({ target: schema.prompts.eventKey });
      } catch (error) {
        // If batch insert fails, fall back to individual inserts for this chunk
        // so we can pinpoint the failing records
        for (let j = 0; j < chunk.length; j++) {
          try {
            await db
              .insert(schema.prompts)
              .values(chunk[j])
              .onConflictDoNothing({ target: schema.prompts.eventKey });
          } catch (innerError) {
            const item = toInsert[i + j];
            rejected++;
            accepted--; // offset the increment below
            errors.push(
              `Error processing record ${item.record.event_id}: ${innerError instanceof Error ? innerError.message : "Unknown error"}`,
            );
          }
        }
      }
    }

    for (const item of toInsert) {
      affectedDates.add(item.dateStr);
    }
    accepted += toInsert.length;
  }

  // ── Phase 6: Refresh daily analytics ───────────────────────────

  if (affectedDates.size > 0) {
    try {
      const earliest = [...affectedDates].sort()[0];
      await refreshDailyAggregations(userId, new Date(earliest));
    } catch (error) {
      logger.error({ error }, "Failed to refresh daily analytics aggregations");
    }
  }

  return {
    success: errors.length === 0,
    accepted,
    duplicates,
    rejected,
    errors: errors.slice(0, 10), // Limit error messages
  };
}
