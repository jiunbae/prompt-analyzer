import { NextRequest, NextResponse } from "next/server";
import {
  verifyPassword,
  hashPassword,
  findUserByEmail,
  isEmailAllowed,
  createUser,
  updateLastLogin,
} from "@/lib/auth";
import { rateLimiters } from "@/lib/rate-limit";

/**
 * POST /api/auth/cli-login
 * CLI authentication endpoint. Returns the user's API token without setting cookies.
 *
 * Supports two flows:
 * 1. Login: email + password → returns token
 * 2. Auto-register: if autoRegister=true and email is on allowlist, creates account
 */
export async function POST(request: NextRequest) {
  try {
    // Rate limit by IP (auth endpoints are unauthenticated)
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rateCheck = rateLimiters.auth(ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many authentication attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } },
      );
    }

    const { email, password, autoRegister, name } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    // Try to find existing user
    const user = await findUserByEmail(email);

    if (user) {
      // Verify password
      const isValid = await verifyPassword(password, user.passwordHash);
      if (!isValid) {
        return NextResponse.json(
          { error: "Invalid email or password" },
          { status: 401 }
        );
      }

      await updateLastLogin(user.id);

      return NextResponse.json({
        success: true,
        token: user.token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      });
    }

    // User doesn't exist
    if (!autoRegister) {
      return NextResponse.json(
        { error: "Account not found", code: "USER_NOT_FOUND" },
        { status: 401 }
      );
    }

    // Auto-register flow
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    // Check allowlist
    const allowed = await isEmailAllowed(email);
    if (!allowed) {
      return NextResponse.json(
        { error: "This email is not authorized to register" },
        { status: 403 }
      );
    }

    // Create user
    const passwordHash = await hashPassword(password);
    const newUser = await createUser({
      email,
      passwordHash,
      name: name || undefined,
    });

    return NextResponse.json({
      success: true,
      token: newUser.token,
      registered: true,
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
      },
    });
  } catch (error) {
    console.error("CLI login error:", error);
    return NextResponse.json(
      { error: "An error occurred during authentication" },
      { status: 500 }
    );
  }
}
