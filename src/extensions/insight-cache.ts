import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { sql, and, eq, gt } from "drizzle-orm";
import { createHash } from "crypto";
import type { InsightResult } from "./types";

/** Hash input data to detect staleness */
export function hashData(data: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(data))
    .digest("hex")
    .slice(0, 16);
}

/** Get a cached insight if it exists and is not expired */
export async function getCachedInsight(
  userId: string,
  insightType: string,
): Promise<InsightResult | null> {

  const conditions = [
    eq(schema.aiInsights.userId, userId),
    eq(schema.aiInsights.insightType, insightType),
    gt(schema.aiInsights.expiresAt, new Date()),
  ];

  const [row] = await db
    .select({ result: schema.aiInsights.result })
    .from(schema.aiInsights)
    .where(and(...conditions))
    .orderBy(sql`generated_at DESC`)
    .limit(1);

  return row ? (row.result as InsightResult) : null;
}

/** Store a generated insight in the cache */
export async function cacheInsight(
  userId: string,
  insightType: string,
  result: InsightResult,
  options: {
    parameters?: Record<string, unknown>;
    dataHash: string;
    model?: string;
    tokensUsed?: number;
    ttlHours?: number;
  },
): Promise<void> {
  const ttl = options.ttlHours ?? 24;
  const expiresAt = new Date(Date.now() + ttl * 60 * 60 * 1000);

  // Atomic delete+insert in a transaction to prevent race conditions
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.aiInsights)
      .where(
        and(
          eq(schema.aiInsights.userId, userId),
          eq(schema.aiInsights.insightType, insightType),
        ),
      );

    await tx.insert(schema.aiInsights).values({
      userId,
      insightType,
      parameters: options.parameters || {},
      dataHash: options.dataHash,
      result: result as unknown as Record<string, unknown>,
      model: options.model,
      tokensUsed: options.tokensUsed,
      expiresAt,
    });
  });
}

/** Delete expired insights */
export async function cleanExpiredInsights(): Promise<number> {
  const result = await db
    .delete(schema.aiInsights)
    .where(sql`${schema.aiInsights.expiresAt} < now()`)
    .returning({ id: schema.aiInsights.id });
  return result.length;
}

/** Get all cached insights for a user */
export async function getUserInsights(
  userId: string,
): Promise<Array<{ id: string; type: string; result: InsightResult; generatedAt: Date }>> {
  const rows = await db
    .select({
      id: schema.aiInsights.id,
      type: schema.aiInsights.insightType,
      result: schema.aiInsights.result,
      generatedAt: schema.aiInsights.generatedAt,
    })
    .from(schema.aiInsights)
    .where(
      and(
        eq(schema.aiInsights.userId, userId),
        gt(schema.aiInsights.expiresAt, new Date()),
      ),
    )
    .orderBy(sql`generated_at DESC`);

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    result: r.result as InsightResult,
    generatedAt: r.generatedAt,
  }));
}
