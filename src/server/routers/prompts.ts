import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { desc, eq, sql, and } from "drizzle-orm";

export const promptsRouter = createTRPCRouter({
  /**
   * List prompts with pagination and filtering
   */
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().default(0),
        projectName: z.string().optional(),
        promptType: z.enum(["user_input", "task_notification", "system"]).optional(),
        search: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {

      const { limit, offset, projectName, promptType, search } = input;

      const conditions = [eq(schema.prompts.userId, ctx.user.id)];
      if (projectName) {
        conditions.push(eq(schema.prompts.projectName, projectName));
      }
      if (promptType) {
        conditions.push(eq(schema.prompts.promptType, promptType));
      }
      if (search) {
        conditions.push(sql`${schema.prompts.searchVector} @@ websearch_to_tsquery('english', ${search})`);
      }

      const whereClause = and(...conditions);

      const [items, countResult] = await Promise.all([
        db.query.prompts.findMany({
          where: whereClause,
          orderBy: [desc(schema.prompts.timestamp)],
          limit,
          offset,
          with: {
            promptTags: {
              with: {
                tag: true,
              },
            },
          },
        }),
        db
          .select({ count: sql<number>`count(*)` })
          .from(schema.prompts)
          .where(whereClause),
      ]);

      return {
        items: items.map((item) => ({
          ...item,
          tags: item.promptTags.map((pt) => pt.tag),
          preview: item.promptText.slice(0, 200) + (item.promptText.length > 200 ? "..." : ""),
        })),
        totalCount: Number(countResult[0]?.count ?? 0),
      };
    }),

  /**
   * Get a single prompt by ID
   */
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {

      const result = await db.query.prompts.findFirst({
        where: and(eq(schema.prompts.id, input.id), eq(schema.prompts.userId, ctx.user.id)),
        with: {
          promptTags: {
            with: {
              tag: true,
            },
          },
        },
      });

      if (!result) return null;

      return {
        ...result,
        tags: result.promptTags.map((pt) => pt.tag),
      };
    }),

  /**
   * Get prompt statistics/analytics
   */
  getStats: protectedProcedure.query(async ({ ctx }) => {


    const [totalResult, projectsResult, typesResult] = await Promise.all([
      db
        .select({
          totalPrompts: sql<number>`count(*)`,
          totalTokens: sql<number>`coalesce(sum(token_estimate), 0)`,
          uniqueProjects: sql<number>`count(distinct project_name)`,
        })
        .from(schema.prompts)
        .where(eq(schema.prompts.userId, ctx.user.id)),
      db
        .select({
          project: schema.prompts.projectName,
          count: sql<number>`count(*)`,
        })
        .from(schema.prompts)
        .where(and(sql`project_name is not null`, eq(schema.prompts.userId, ctx.user.id)))
        .groupBy(schema.prompts.projectName)
        .orderBy(desc(sql`count(*)`))
        .limit(10),
      db
        .select({
          type: schema.prompts.promptType,
          count: sql<number>`count(*)`,
        })
        .from(schema.prompts)
        .where(eq(schema.prompts.userId, ctx.user.id))
        .groupBy(schema.prompts.promptType),
    ]);

    const promptsByType: Record<string, number> = {};
    typesResult.forEach((t) => {
      if (t.type) promptsByType[t.type] = Number(t.count);
    });

    return {
      totalPrompts: Number(totalResult[0]?.totalPrompts ?? 0),
      totalTokens: Number(totalResult[0]?.totalTokens ?? 0),
      uniqueProjects: Number(totalResult[0]?.uniqueProjects ?? 0),
      promptsByType,
      promptsByProject: projectsResult.map((p) => ({
        project: p.project ?? "unknown",
        count: Number(p.count),
      })),
    };
  }),

  /**
   * Get unique project names
   */
  getProjects: protectedProcedure.query(async ({ ctx }) => {

    const result = await db
      .select({
        projectName: schema.prompts.projectName,
        promptCount: sql<number>`count(*)`,
        lastPrompt: sql<Date>`max(timestamp)`,
      })
      .from(schema.prompts)
      .where(and(sql`project_name is not null`, eq(schema.prompts.userId, ctx.user.id)))
      .groupBy(schema.prompts.projectName)
      .orderBy(desc(sql`count(*)`));

    return result.map((r) => ({
      projectName: r.projectName ?? "unknown",
      promptCount: Number(r.promptCount),
      lastPrompt: r.lastPrompt,
    }));
  }),
});

export type PromptsRouter = typeof promptsRouter;
