import { NextResponse } from "next/server";
import { findUserById } from "@/lib/auth";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    const session = await requireAuth();

    // Fetch fresh user data from database
    const user = await findUserById(session.userId);
    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 401 }
      );
    }

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        token: user.token,
        isAdmin: user.isAdmin ?? false,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Auth check error");
    return NextResponse.json(
      { error: "An error occurred checking authentication" },
      { status: 500 }
    );
  }
}
