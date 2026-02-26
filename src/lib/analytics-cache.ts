import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { sql, and, eq, gte } from "drizzle-orm";

/**
 * Refreshes analytics_daily for a given user and date range.
 * Called after sync upload and on a scheduled basis.
 *
 * Aggregates from the prompts table: count, total_chars, total_tokens,
 * total_response_tokens, unique_projects, avg_length.
 * Uses UPSERT keyed on (user_id, date).
 */
export async function refreshDailyAggregations(
  userId: string,
  fromDate?: Date,
): Promise<void> {
  // Default to 30 days ago if no fromDate provided
  const rangeFrom =
    fromDate ??
    (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 30);
      d.setUTCHours(0, 0, 0, 0);
      return d;
    })();

  // Aggregate and upsert in a single transaction for consistency
  await db.transaction(async (tx) => {
    // Aggregate per-day stats from prompts for this user
    const dailyRows = await tx
        .select({
          date: sql<string>`date(${schema.prompts.timestamp})`,
          promptCount: sql<number>`count(*)::int`,
          totalChars: sql<number>`coalesce(sum(${schema.prompts.promptLength} + coalesce(${schema.prompts.responseLength}, 0)), 0)::int`,
          totalTokensEst: sql<number>`coalesce(sum(${schema.prompts.tokenEstimate} + coalesce(${schema.prompts.tokenEstimateResponse}, 0)), 0)::int`,
          totalResponseTokens: sql<number>`coalesce(sum(${schema.prompts.tokenEstimateResponse}), 0)::int`,
          uniqueProjects: sql<number>`count(distinct ${schema.prompts.projectName})::int`,
          avgPromptLength: sql<string>`coalesce(avg(${schema.prompts.promptLength}), 0)::numeric(10,2)`,
        })
        .from(schema.prompts)
        .where(
          and(
            eq(schema.prompts.userId, userId),
            gte(schema.prompts.timestamp, rangeFrom),
          ),
        )
        .groupBy(sql`date(${schema.prompts.timestamp})`);

      if (dailyRows.length > 0) {
        const values = dailyRows
          .map((row) => sql`(gen_random_uuid(), ${userId}, ${row.date}, ${row.promptCount}, ${row.totalChars}, ${row.totalTokensEst}, ${row.totalResponseTokens}, ${row.uniqueProjects}, ${row.avgPromptLength}, now())`)
          .reduce((acc, v, i) => (i === 0 ? v : sql`${acc}, ${v}`));

        await tx.execute(sql`
          INSERT INTO analytics_daily (id, user_id, date, prompt_count, total_chars, total_tokens_est, total_response_tokens, unique_projects, avg_prompt_length, updated_at)
          VALUES ${values}
          ON CONFLICT (user_id, date)
          DO UPDATE SET
            prompt_count = EXCLUDED.prompt_count,
            total_chars = EXCLUDED.total_chars,
            total_tokens_est = EXCLUDED.total_tokens_est,
            total_response_tokens = EXCLUDED.total_response_tokens,
            unique_projects = EXCLUDED.unique_projects,
            avg_prompt_length = EXCLUDED.avg_prompt_length,
            updated_at = now()
        `);
      }
    });
}
