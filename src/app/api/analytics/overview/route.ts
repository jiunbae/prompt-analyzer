import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { parseDateRange } from "../_helpers";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const userId = session.userId;

    const { searchParams } = new URL(request.url);
    const { from, to } = parseDateRange(searchParams);

    const whereClause = and(
      eq(schema.prompts.userId, userId),
      gte(schema.prompts.timestamp, from),
      lt(schema.prompts.timestamp, to)
    );

    const [stats, topProjects, promptTypes] = await Promise.all([
      db
        .select({
          totalPrompts: sql<number>`count(*)`,
          totalTokens: sql<number>`coalesce(sum(coalesce(token_estimate, 0) + coalesce(token_estimate_response, 0)), 0)`,
          uniqueProjects: sql<number>`count(distinct project_name)`,
          avgPromptLength: sql<number>`avg(prompt_length)`,
        })
        .from(schema.prompts)
        .where(whereClause),

      db
        .select({
          project: schema.prompts.projectName,
          promptCount: sql<number>`count(*)`,
          tokens: sql<number>`coalesce(sum(coalesce(token_estimate, 0) + coalesce(token_estimate_response, 0)), 0)`,
        })
        .from(schema.prompts)
        .where(and(whereClause, sql`project_name is not null`))
        .groupBy(schema.prompts.projectName)
        .orderBy(desc(sql`count(*)`))
        .limit(10),

      db
        .select({
          type: schema.prompts.promptType,
          count: sql<number>`count(*)`,
        })
        .from(schema.prompts)
        .where(whereClause)
        .groupBy(schema.prompts.promptType)
        .orderBy(desc(sql`count(*)`)),
    ]);

    return NextResponse.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      stats: {
        totalPrompts: Number(stats[0]?.totalPrompts ?? 0),
        totalTokens: Number(stats[0]?.totalTokens ?? 0),
        uniqueProjects: Number(stats[0]?.uniqueProjects ?? 0),
        avgPromptLength: Number(stats[0]?.avgPromptLength ?? 0),
      },
      topProjects: topProjects.map((p) => ({
        project: p.project,
        promptCount: Number(p.promptCount ?? 0),
        tokens: Number(p.tokens ?? 0),
      })),
      promptTypes: promptTypes.map((t) => ({
        type: t.type,
        count: Number(t.count ?? 0),
      })),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Analytics overview API error");
    return NextResponse.json(
      { error: "Failed to load overview analytics" },
      { status: 500 }
    );
  }
}
