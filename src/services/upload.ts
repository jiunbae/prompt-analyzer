import { logger } from "@/lib/logger";
import { env } from "@/env";
import { updateDailyAnalytics } from "./sync";

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
    for (const record of records) {
      if (!record.event_id || !record.created_at || !record.prompt_text) {
        rejected++;
        errors.push(`Invalid record: missing required fields (event_id, created_at, prompt_text)`);
        continue;
      }

      const eventKey = buildEventKey(userToken, record.created_at, record.event_id);
      const dateStr = new Date(record.created_at).toISOString().split("T")[0];

      try {
        // Insert into PostgreSQL
        const promptType = record.prompt_text.includes("<task-notification>")
          ? "task_notification"
          : record.prompt_text.includes("<system-reminder>")
            ? "system"
            : "user_input";

        const [inserted] = await db
          .insert(schema.prompts)
          .values({
            eventKey,
            timestamp: new Date(record.created_at),
            workingDirectory: record.cwd || "unknown",
            promptLength: record.prompt_length,
            promptText: record.prompt_text,
            responseText: record.response_text || undefined,
            responseLength: record.response_length || undefined,
            projectName: record.project || null,
            promptType,
            userId,
            source: record.source || undefined,
            sessionId: record.session_id || undefined,
            deviceName: deviceId || undefined,
            tokenEstimate: record.token_estimate || Math.ceil(record.prompt_length / 4),
            wordCount: record.word_count || record.prompt_text.split(/\s+/).filter(Boolean).length,
            tokenEstimateResponse: record.token_estimate_response || undefined,
            wordCountResponse: record.word_count_response || undefined,
            searchVector: sql`to_tsvector('english', ${record.prompt_text} || ' ' || ${record.response_text ?? ""})`,
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
