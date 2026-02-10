import { NextRequest, NextResponse } from "next/server";
import { findUserByToken, updateDailyAnalytics } from "@/services/sync";
import { logger } from "@/lib/logger";

export async function DELETE(request: NextRequest) {
  try {
    const userToken = request.headers.get("X-User-Token");

    if (!userToken) {
      return NextResponse.json(
        { error: "Authentication required. Provide X-User-Token header." },
        { status: 401 }
      );
    }

    const user = await findUserByToken(userToken);
    if (!user) {
      return NextResponse.json(
        { error: "Invalid user token" },
        { status: 401 }
      );
    }

    const postgres = (await import("postgres")).default;
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { eq, sql } = await import("drizzle-orm");
    const schema = await import("@/db/schema");
    const { env } = await import("@/env");

    const client = postgres(env.DATABASE_URL);
    const db = drizzle(client, { schema });

    try {
      // Collect affected dates before deleting
      const affectedDates = await db
        .selectDistinct({ date: sql<string>`date(timestamp)` })
        .from(schema.prompts)
        .where(eq(schema.prompts.userId, user.id));

      // Delete prompts (prompt_tags cascade via ON DELETE CASCADE)
      const result = await db
        .delete(schema.prompts)
        .where(eq(schema.prompts.userId, user.id))
        .returning({ id: schema.prompts.id });

      // Recalculate analytics for affected dates
      for (const { date } of affectedDates) {
        try {
          await updateDailyAnalytics(date);
        } catch (error) {
          logger.error({ error, date }, "Failed to recalculate analytics");
        }
      }

      logger.info({ userId: user.id, deleted: result.length }, "User data flushed");

      return NextResponse.json({
        success: true,
        deleted: result.length,
      });
    } finally {
      await client.end();
    }
  } catch (error) {
    logger.error({ error }, "Flush error");
    return NextResponse.json(
      { error: "An error occurred during flush" },
      { status: 500 }
    );
  }
}
