import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

/**
 * GET /api/admin/users
 * List all users (admin only)
 */
export async function GET() {
  try {
    const session = await requireAuth();

    if (!session.isAdmin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

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
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("Error listing users:", error);
    return NextResponse.json({ error: "An error occurred" }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/users
 * Update user admin status (admin only)
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAuth();

    if (!session.isAdmin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { userId, isAdmin } = await request.json();

    if (!userId || typeof isAdmin !== "boolean") {
      return NextResponse.json(
        { error: "userId and isAdmin (boolean) are required" },
        { status: 400 },
      );
    }

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
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("Error updating user:", error);
    return NextResponse.json({ error: "An error occurred" }, { status: 500 });
  }
}
