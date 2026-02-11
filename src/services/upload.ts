import { logger } from "@/lib/logger";
import { env } from "@/env";
import { updateDailyAnalytics } from "./sync";
import type { UploadRecord, UploadResult } from "./upload-types";
import { postprocessUploadRecordForDb } from "./upload-postprocess";

export type { UploadRecord, UploadResult } from "./upload-types";

function sanitizeEventId(eventId: string): string {
  // Allowlist: only alphanumeric, hyphens, and underscores
  return eventId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function buildEventKey(userToken: string, createdAt: string, eventId: string): string {
  const date = new Date(createdAt);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
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

      const processed = postprocessUploadRecordForDb(record, {
        redactEnabled,
        redactMask,
      });

      const eventKey = buildEventKey(userToken, record.created_at, record.event_id);
      const dateStr = new Date(record.created_at).toISOString().split("T")[0];

      try {
        // Insert into PostgreSQL
        const promptType = processed.promptText.includes("<task-notification>")
          ? "task_notification"
          : processed.promptText.includes("<system-reminder>")
            ? "system"
            : "user_input";

        const [inserted] = await db
          .insert(schema.prompts)
          .values({
            eventKey,
            timestamp: new Date(record.created_at),
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
          })
          .onConflictDoUpdate({
            target: schema.prompts.eventKey,
            set: {
              responseText: sql`COALESCE(EXCLUDED.response_text, ${schema.prompts.responseText})`,
              responseLength: sql`COALESCE(EXCLUDED.response_length, ${schema.prompts.responseLength})`,
              tokenEstimateResponse: sql`COALESCE(EXCLUDED.token_estimate_response, ${schema.prompts.tokenEstimateResponse})`,
              wordCountResponse: sql`COALESCE(EXCLUDED.word_count_response, ${schema.prompts.wordCountResponse})`,
              updatedAt: sql`now()`,
            },
          })
          .returning();

        if (!inserted) {
          duplicates++;
          continue;
        }

        // Check if this was an update (response added) vs a fresh insert
        const isUpdate = inserted.syncedAt !== null && inserted.syncedAt !== undefined;

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
