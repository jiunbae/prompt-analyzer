import { NextRequest, NextResponse } from "next/server";
import { findUserByToken } from "@/services/sync";
import { logger } from "@/lib/logger";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";

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
  } catch (error) {
    logger.error({ error }, "Flush error");
    return NextResponse.json(
      { error: "An error occurred during flush" },
      { status: 500 }
    );
  }
}
