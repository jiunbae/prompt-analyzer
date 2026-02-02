import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../trpc";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { desc, eq, ilike, sql, and } from "drizzle-orm";

// Lazy database connection
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getDb() {
  if (!db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    const client = postgres(connectionString);
    db = drizzle(client, { schema });
  }
  return db;
}

export const promptsRouter = createTRPCRouter({
  /**
   * List prompts with pagination and filtering
   */
  list: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().default(0),
        projectName: z.string().optional(),
        promptType: z.enum(["user_input", "task_notification", "system"]).optional(),
        search: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const db = getDb();
      const { limit, offset, projectName, promptType, search } = input;

      const conditions = [];
      if (projectName) {
        conditions.push(eq(schema.prompts.projectName, projectName));
      }
      if (promptType) {
        conditions.push(eq(schema.prompts.promptType, promptType));
      }
      if (search) {
        conditions.push(ilike(schema.prompts.promptText, `%${search}%`));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [items, countResult] = await Promise.all([
        db
          .select({
            id: schema.prompts.id,
            timestamp: schema.prompts.timestamp,
            projectName: schema.prompts.projectName,
            promptType: schema.prompts.promptType,
            promptLength: schema.prompts.promptLength,
            tokenEstimate: schema.prompts.tokenEstimate,
            promptText: schema.prompts.promptText,
          })
          .from(schema.prompts)
          .where(whereClause)
          .orderBy(desc(schema.prompts.timestamp))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)` })
          .from(schema.prompts)
          .where(whereClause),
      ]);

      return {
        items: items.map((item) => ({
          ...item,
          preview: item.promptText.slice(0, 200) + (item.promptText.length > 200 ? "..." : ""),
        })),
        totalCount: Number(countResult[0]?.count ?? 0),
      };
    }),

  /**
   * Get a single prompt by ID
   */
  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const db = getDb();
      const result = await db
        .select()
        .from(schema.prompts)
        .where(eq(schema.prompts.id, input.id))
        .limit(1);

      return result[0] ?? null;
    }),

  /**
   * Get prompt statistics/analytics
   */
  getStats: publicProcedure.query(async () => {
    const db = getDb();

    const [totalResult, projectsResult, typesResult] = await Promise.all([
      db
        .select({
          totalPrompts: sql<number>`count(*)`,
          totalTokens: sql<number>`coalesce(sum(token_estimate), 0)`,
          uniqueProjects: sql<number>`count(distinct project_name)`,
        })
        .from(schema.prompts),
      db
        .select({
          project: schema.prompts.projectName,
          count: sql<number>`count(*)`,
        })
        .from(schema.prompts)
        .where(sql`project_name is not null`)
        .groupBy(schema.prompts.projectName)
        .orderBy(desc(sql`count(*)`))
        .limit(10),
      db
        .select({
          type: schema.prompts.promptType,
          count: sql<number>`count(*)`,
        })
        .from(schema.prompts)
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
  getProjects: publicProcedure.query(async () => {
    const db = getDb();
    const result = await db
      .select({
        projectName: schema.prompts.projectName,
        promptCount: sql<number>`count(*)`,
        lastPrompt: sql<Date>`max(timestamp)`,
      })
      .from(schema.prompts)
      .where(sql`project_name is not null`)
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
