import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/with-auth";
import { db } from "@/db/client";
import { users, allowedEmails } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/admin/allowlist
 * List all allowed emails (admin only)
 */
export async function GET() {
  try {
    await requireAdmin();

    const entries = await db
      .select({
        id: allowedEmails.id,
        email: allowedEmails.email,
        addedBy: allowedEmails.addedBy,
        addedAt: allowedEmails.addedAt,
        addedByName: users.name,
        addedByEmail: users.email,
      })
      .from(allowedEmails)
      .leftJoin(users, eq(allowedEmails.addedBy, users.id));

    return NextResponse.json({
      allowedEmails: entries.map((e) => ({
        id: e.id,
        email: e.email,
        addedAt: e.addedAt,
        addedBy: e.addedBy
          ? {
              id: e.addedBy,
              name: e.addedByName,
              email: e.addedByEmail,
            }
          : null,
      })),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Error listing allowlist:", error);
    return NextResponse.json({ error: "An error occurred" }, { status: 500 });
  }
}

/**
 * POST /api/admin/allowlist
 * Add email to allowlist (admin only)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAdmin();

    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }

    // Check if email already exists in allowlist
    const [existing] = await db
      .select()
      .from(allowedEmails)
      .where(eq(allowedEmails.email, email.toLowerCase()))
      .limit(1);

    if (existing) {
      return NextResponse.json({ error: "Email is already in the allowlist" }, { status: 409 });
    }

    const [newEntry] = await db
      .insert(allowedEmails)
      .values({
        email: email.toLowerCase(),
        addedBy: session.userId,
      })
      .returning();

    return NextResponse.json({
      success: true,
      allowedEmail: {
        id: newEntry.id,
        email: newEntry.email,
        addedAt: newEntry.addedAt,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Error adding to allowlist:", error);
    return NextResponse.json({ error: "An error occurred" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/allowlist
 * Remove email from allowlist (admin only)
 */
export async function DELETE(request: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email");
    const id = searchParams.get("id");

    if (!email && !id) {
      return NextResponse.json({ error: "Email or ID is required" }, { status: 400 });
    }

    let deleted;
    if (id) {
      [deleted] = await db
        .delete(allowedEmails)
        .where(eq(allowedEmails.id, id))
        .returning();
    } else if (email) {
      [deleted] = await db
        .delete(allowedEmails)
        .where(eq(allowedEmails.email, email.toLowerCase()))
        .returning();
    }

    if (!deleted) {
      return NextResponse.json({ error: "Email not found in allowlist" }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: "Email removed from allowlist" });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Error removing from allowlist:", error);
    return NextResponse.json({ error: "An error occurred" }, { status: 500 });
  }
}
