import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import crypto from "crypto";
import { z } from "zod";

const createShareSchema = z.object({
  promptId: z.string().uuid("promptId must be a valid UUID"),
  expiresIn: z
    .number()
    .int()
    .positive()
    .max(8760) // max 1 year in hours
    .nullable()
    .optional()
    .default(null),
});

// POST /api/share - Create a share link
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();

    const body = await request.json();
    const parsed = createShareSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { promptId, expiresIn } = parsed.data;

    // Verify the prompt belongs to the user
    const [prompt] = await db
      .select({ id: schema.prompts.id })
      .from(schema.prompts)
      .where(
        and(
          eq(schema.prompts.id, promptId),
          eq(schema.prompts.userId, session.userId)
        )
      )
      .limit(1);

    if (!prompt) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    const shareToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = expiresIn
      ? new Date(Date.now() + expiresIn * 60 * 60 * 1000)
      : null;

    const [shared] = await db
      .insert(schema.sharedPrompts)
      .values({
        promptId,
        userId: session.userId,
        shareToken,
        expiresAt,
      })
      .returning();

    return NextResponse.json({ shared }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Share POST error");
    return NextResponse.json({ error: "Failed to create share link" }, { status: 500 });
  }
}

// GET /api/share - List user's shared links
export async function GET() {
  try {
    const session = await requireAuth();

    const shares = await db
      .select({
        id: schema.sharedPrompts.id,
        promptId: schema.sharedPrompts.promptId,
        shareToken: schema.sharedPrompts.shareToken,
        expiresAt: schema.sharedPrompts.expiresAt,
        viewCount: schema.sharedPrompts.viewCount,
        isActive: schema.sharedPrompts.isActive,
        createdAt: schema.sharedPrompts.createdAt,
        promptText: sql<string>`LEFT(${schema.prompts.promptText}, 200)`,
        projectName: schema.prompts.projectName,
      })
      .from(schema.sharedPrompts)
      .innerJoin(schema.prompts, eq(schema.sharedPrompts.promptId, schema.prompts.id))
      .where(eq(schema.sharedPrompts.userId, session.userId))
      .orderBy(sql`${schema.sharedPrompts.createdAt} DESC`);

    return NextResponse.json({ shares });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Share GET error");
    return NextResponse.json({ error: "Failed to fetch shares" }, { status: 500 });
  }
}

const deleteShareSchema = z.object({
  id: z.string().uuid("id must be a valid UUID"),
});

// DELETE /api/share - Revoke a share link (id in body or query)
export async function DELETE(request: NextRequest) {
  try {
    const session = await requireAuth();

    const url = new URL(request.url);
    const parsed = deleteShareSchema.safeParse({ id: url.searchParams.get("id") });
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid id parameter", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { id } = parsed.data;

    const rows = await db
      .update(schema.sharedPrompts)
      .set({ isActive: false })
      .where(
        and(
          eq(schema.sharedPrompts.id, id),
          eq(schema.sharedPrompts.userId, session.userId)
        )
      )
      .returning({ id: schema.sharedPrompts.id });

    if (rows.length === 0) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Share DELETE error");
    return NextResponse.json({ error: "Failed to revoke share" }, { status: 500 });
  }
}
