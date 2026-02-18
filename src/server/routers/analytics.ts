import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { eq, desc, sql, gte, lte, and } from "drizzle-orm";

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

export const analyticsRouter = createTRPCRouter({
  getDailyStats: protectedProcedure
    .input(
      z.object({
        from: z.string().optional(),
        to: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const conditions = [
        eq(schema.analyticsDaily.userId, ctx.user.id),
      ];

      if (input.from) {
        conditions.push(gte(schema.analyticsDaily.date, input.from));
      }
      if (input.to) {
        conditions.push(lte(schema.analyticsDaily.date, input.to));
      }

      return await db
        .select()
        .from(schema.analyticsDaily)
        .where(and(...conditions))
        .orderBy(schema.analyticsDaily.date);
    }),

  getOverview: protectedProcedure.query(async ({ ctx }) => {
    const db = getDb();
    
    const [totals] = await db
      .select({
        totalPrompts: sql<number>`count(*)`,
        totalTokens: sql<number>`sum(token_estimate + coalesce(token_estimate_response, 0))`,
        totalChars: sql<number>`sum(prompt_length + coalesce(response_length, 0))`,
      })
      .from(schema.prompts)
      .where(eq(schema.prompts.userId, ctx.user.id));

    return {
      totalPrompts: Number(totals?.totalPrompts ?? 0),
      totalTokens: Number(totals?.totalTokens ?? 0),
      totalChars: Number(totals?.totalChars ?? 0),
    };
  }),
});
