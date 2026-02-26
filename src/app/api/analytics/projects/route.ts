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

    const url = new URL(request.url);
    const { searchParams } = url;
    const { from, to } = parseDateRange(searchParams);

    const project = searchParams.get("project")?.trim() || null;

    const limitParam = searchParams.get("limit");
    let limit = 20;
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (!Number.isNaN(parsed) && parsed > 0) limit = Math.min(parsed, 50);
    }

    const baseWhere = and(
      eq(schema.prompts.userId, userId),
      gte(schema.prompts.timestamp, from),
      lt(schema.prompts.timestamp, to),
      eq(schema.prompts.promptType, "user_input")
    );

    const dateExpr = sql<string>`date(${schema.prompts.timestamp})`;

    const topProjectsPromise = db
      .select({
        project: schema.prompts.projectName,
        promptCount: sql<number>`count(*)`,
        tokens: sql<number>`coalesce(sum(coalesce(token_estimate, 0) + coalesce(token_estimate_response, 0)), 0)`,
        lastActive: sql<Date>`max(${schema.prompts.timestamp})`,
      })
      .from(schema.prompts)
      .where(and(baseWhere, sql`project_name is not null`))
      .groupBy(schema.prompts.projectName)
      .orderBy(desc(sql`count(*)`))
      .limit(limit);

    const topProjects = await topProjectsPromise;

    const timeline = project
      ? await db
          .select({
            date: dateExpr,
            promptCount: sql<number>`count(*)`,
            tokens: sql<number>`coalesce(sum(coalesce(token_estimate, 0) + coalesce(token_estimate_response, 0)), 0)`,
          })
          .from(schema.prompts)
          .where(and(baseWhere, eq(schema.prompts.projectName, project)))
          .groupBy(dateExpr)
          .orderBy(dateExpr)
      : [];

    return NextResponse.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      topProjects: topProjects.map((p) => ({
        project: p.project,
        promptCount: Number(p.promptCount ?? 0),
        tokens: Number(p.tokens ?? 0),
        lastActive: p.lastActive ? new Date(p.lastActive).toISOString() : null,
      })),
      timeline: timeline.map((t) => ({
        date: t.date,
        promptCount: Number(t.promptCount ?? 0),
        tokens: Number(t.tokens ?? 0),
      })),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Analytics projects API error");
    return NextResponse.json(
      { error: "Failed to load projects analytics" },
      { status: 500 }
    );
  }
}
