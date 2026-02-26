import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { sql, eq, gte, desc, and, inArray } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(request.url);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);

    // Determine which users to fetch
    let targetUserIds: string[];
    const userIdsParam = searchParams.get("userIds");

    if (userIdsParam) {
      targetUserIds = userIdsParam.split(",").filter(Boolean);
      if (targetUserIds.length > 20) {
        targetUserIds = targetUserIds.slice(0, 20);
      }
    } else {
      // Fetch all users who have activity in the last 30 days
      const activeUsers = await db
        .select({ userId: schema.prompts.userId })
        .from(schema.prompts)
        .where(gte(schema.prompts.timestamp, thirtyDaysAgo))
        .groupBy(schema.prompts.userId)
        .orderBy(desc(sql`count(*)`))
        .limit(20);
      targetUserIds = activeUsers.map((u) => u.userId).filter((id): id is string => id !== null);
    }

    if (targetUserIds.length === 0) {
      return NextResponse.json({ users: [] });
    }

    // Per-user daily token stats (parameterized -- no sql.raw)
    const rows = await db
      .select({
        userId: schema.prompts.userId,
        date: sql<string>`date(${schema.prompts.timestamp})`,
        tokens: sql<number>`coalesce(sum(coalesce(${schema.prompts.tokenEstimate},0) + coalesce(${schema.prompts.tokenEstimateResponse},0)),0)`,
        inputTokens: sql<number>`coalesce(sum(coalesce(${schema.prompts.tokenEstimate},0)),0)`,
        outputTokens: sql<number>`coalesce(sum(coalesce(${schema.prompts.tokenEstimateResponse},0)),0)`,
        prompts: sql<number>`count(*)`,
      })
      .from(schema.prompts)
      .where(
        and(
          inArray(schema.prompts.userId, targetUserIds),
          gte(schema.prompts.timestamp, thirtyDaysAgo),
        )
      )
      .groupBy(schema.prompts.userId, sql`date(${schema.prompts.timestamp})`)
      .orderBy(sql`date(${schema.prompts.timestamp})`);

    // Get user names
    const userRows = await db
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
      .from(schema.users)
      .where(inArray(schema.users.id, targetUserIds));

    const userMap = new Map(userRows.map((u) => [u.id, u]));

    // Group by userId
    const perUser: Record<string, {
      id: string;
      name: string;
      email: string;
      dailyStats: Array<{ date: string; tokens: number; inputTokens: number; outputTokens: number; prompts: number }>;
      totalTokens: number;
    }> = {};

    for (const id of targetUserIds) {
      const u = userMap.get(id);
      perUser[id] = {
        id,
        name: u?.name || u?.email?.split("@")[0] || id.slice(0, 8),
        email: u?.email || "",
        dailyStats: [],
        totalTokens: 0,
      };
    }

    for (const row of rows) {
      const uid = row.userId as string;
      if (perUser[uid]) {
        const tokens = Number(row.tokens);
        perUser[uid].dailyStats.push({
          date: row.date,
          tokens,
          inputTokens: Number(row.inputTokens),
          outputTokens: Number(row.outputTokens),
          prompts: Number(row.prompts),
        });
        perUser[uid].totalTokens += tokens;
      }
    }

    // Sort by total tokens descending
    const sorted = Object.values(perUser).sort((a, b) => b.totalTokens - a.totalTokens);

    return NextResponse.json({ users: sorted });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Admin analytics compare error");
    return NextResponse.json(
      { error: "Failed to load analytics comparison" },
      { status: 500 }
    );
  }
}
