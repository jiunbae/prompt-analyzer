import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { rateLimiters } from "@/lib/rate-limit";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * POST /api/auth/regenerate-token
 * Regenerate the user's API token (invalidates the old one)
 */
export async function POST() {
  try {
    const session = await requireAuth();

    const rateLimit = rateLimiters.auth(session.userId);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000)) },
        }
      );
    }

    // Generate new token and update user
    const [updatedUser] = await db
      .update(users)
      .set({
        token: sql`gen_random_uuid()`,
      })
      .where(eq(users.id, session.userId))
      .returning({ token: users.token });

    if (!updatedUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      token: updatedUser.token,
      message: "Token regenerated successfully. Update your prompt capture hook configuration.",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("Token regeneration error:", error);
    return NextResponse.json(
      { error: "Failed to regenerate token" },
      { status: 500 }
    );
  }
}
