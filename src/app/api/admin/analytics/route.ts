import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { getAnalytics } from "@/lib/analytics";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();

    // Parse optional userId filter
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId") || null;

    // Fetch analytics (null = all users)
    const analytics = await getAnalytics(userId);

    const [userList, userSummaryRows] = await Promise.all([
      // User list for filter dropdown
      db
        .select({
          id: schema.users.id,
          name: schema.users.name,
          email: schema.users.email,
        })
        .from(schema.users)
        .orderBy(schema.users.email),

      // Per-user summary
      db
        .select({
          id: schema.users.id,
          name: schema.users.name,
          email: schema.users.email,
          totalPrompts: sql<number>`count(*)`,
          totalTokens: sql<number>`coalesce(sum(${schema.prompts.tokenEstimate}), 0)`,
          uniqueProjects: sql<number>`count(distinct ${schema.prompts.projectName})`,
          lastActivity: sql<string>`max(${schema.prompts.timestamp})`,
          prompts30d: sql<number>`count(*) filter (where ${schema.prompts.timestamp} >= now() - interval '30 days')`,
        })
        .from(schema.prompts)
        .innerJoin(schema.users, eq(schema.prompts.userId, schema.users.id))
        .groupBy(schema.users.id, schema.users.name, schema.users.email)
        .orderBy(desc(sql`count(*)`)),
    ]);

    return NextResponse.json({
      analytics,
      users: userList,
      userSummary: userSummaryRows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        totalPrompts: Number(row.totalPrompts),
        totalTokens: Number(row.totalTokens),
        uniqueProjects: Number(row.uniqueProjects),
        lastActivity: row.lastActivity,
        prompts30d: Number(row.prompts30d),
      })),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Admin analytics API error");
    return NextResponse.json(
      { error: "Failed to load admin analytics" },
      { status: 500 }
    );
  }
}
