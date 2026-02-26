import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";

/**
 * GET /api/admin/users
 * List all users (admin only)
 */
export async function GET() {
  try {
    await requireAdmin();

    const allUsers = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        isAdmin: users.isAdmin,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt));

    return NextResponse.json({ users: allUsers });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Error listing users");
    return NextResponse.json({ error: "An error occurred" }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/users
 * Update user admin status (admin only)
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAdmin();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const patchSchema = z.object({
      userId: z.string().uuid(),
      isAdmin: z.boolean(),
    });
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "userId (UUID) and isAdmin (boolean) are required" },
        { status: 400 },
      );
    }

    const { userId, isAdmin } = parsed.data;

    // Prevent admin from removing their own admin status
    if (userId === session.userId && !isAdmin) {
      return NextResponse.json(
        { error: "Cannot remove your own admin status" },
        { status: 403 },
      );
    }

    const [updated] = await db
      .update(users)
      .set({ isAdmin })
      .where(eq(users.id, userId))
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        isAdmin: users.isAdmin,
      });

    if (!updated) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ user: updated });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Error updating user");
    return NextResponse.json({ error: "An error occurred" }, { status: 500 });
  }
}
