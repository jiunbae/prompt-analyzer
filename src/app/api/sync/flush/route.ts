import { NextRequest, NextResponse } from "next/server";
import { findUserByToken } from "@/services/sync";
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
    const { eq } = await import("drizzle-orm");
    const schema = await import("@/db/schema");
    const { env } = await import("@/env");

    const client = postgres(env.DATABASE_URL);
    const db = drizzle(client, { schema });

    try {
      // Delete prompts (prompt_tags cascade via ON DELETE CASCADE)
      const result = await db
        .delete(schema.prompts)
        .where(eq(schema.prompts.userId, user.id))
        .returning({ id: schema.prompts.id });

      // Delete stale analytics_daily rows for this user (no prompts remain)
      await db
        .delete(schema.analyticsDaily)
        .where(eq(schema.analyticsDaily.userId, user.id));

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
