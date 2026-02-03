import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME, getDb } from "@/lib/auth";
import { eq, sql } from "drizzle-orm";

/**
 * POST /api/auth/regenerate-token
 * Regenerate the user's API token (invalidates the old one)
 */
export async function POST() {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;

    if (!sessionToken) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const session = parseSessionToken(sessionToken);
    if (!session) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const { db, usersTable } = await getDb();

    // Generate new token and update user
    const [updatedUser] = await db
      .update(usersTable)
      .set({
        token: sql`gen_random_uuid()`,
      })
      .where(eq(usersTable.id, session.userId))
      .returning({ token: usersTable.token });

    if (!updatedUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      token: updatedUser.token,
      message: "Token regenerated successfully. Update your Claude Code hook configuration.",
    });
  } catch (error) {
    console.error("Token regeneration error:", error);
    return NextResponse.json(
      { error: "Failed to regenerate token" },
      { status: 500 }
    );
  }
}
