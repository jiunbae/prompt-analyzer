import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionToken, getDb, AUTH_COOKIE_NAME } from "@/lib/auth";

/**
 * GET /api/admin/allowlist
 * List all allowed emails (admin only)
 */
export async function GET() {
  try {
    // Check authentication and admin status
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;

    if (!sessionToken) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const session = parseSessionToken(sessionToken);
    if (!session) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    if (!session.isAdmin) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    // Get all allowed emails
    const { db, allowedEmailsTable, usersTable } = await getDb();
    const { eq } = await import("drizzle-orm");

    const allowedEmails = await db
      .select({
        id: allowedEmailsTable.id,
        email: allowedEmailsTable.email,
        addedBy: allowedEmailsTable.addedBy,
        addedAt: allowedEmailsTable.addedAt,
        addedByName: usersTable.name,
        addedByEmail: usersTable.email,
      })
      .from(allowedEmailsTable)
      .leftJoin(usersTable, eq(allowedEmailsTable.addedBy, usersTable.id));

    return NextResponse.json({
      allowedEmails: allowedEmails.map((e) => ({
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
    console.error("Error listing allowlist:", error);
    return NextResponse.json(
      { error: "An error occurred" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/allowlist
 * Add email to allowlist (admin only)
 */
export async function POST(request: NextRequest) {
  try {
    // Check authentication and admin status
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;

    if (!sessionToken) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const session = parseSessionToken(sessionToken);
    if (!session) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    if (!session.isAdmin) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    const { email } = await request.json();

    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      );
    }

    const { db, allowedEmailsTable } = await getDb();
    const { eq } = await import("drizzle-orm");

    // Check if email already exists in allowlist
    const [existing] = await db
      .select()
      .from(allowedEmailsTable)
      .where(eq(allowedEmailsTable.email, email.toLowerCase()))
      .limit(1);

    if (existing) {
      return NextResponse.json(
        { error: "Email is already in the allowlist" },
        { status: 409 }
      );
    }

    // Add email to allowlist
    const [newEntry] = await db
      .insert(allowedEmailsTable)
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
    console.error("Error adding to allowlist:", error);
    return NextResponse.json(
      { error: "An error occurred" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/allowlist
 * Remove email from allowlist (admin only)
 */
export async function DELETE(request: NextRequest) {
  try {
    // Check authentication and admin status
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;

    if (!sessionToken) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const session = parseSessionToken(sessionToken);
    if (!session) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    if (!session.isAdmin) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email");
    const id = searchParams.get("id");

    if (!email && !id) {
      return NextResponse.json(
        { error: "Email or ID is required" },
        { status: 400 }
      );
    }

    const { db, allowedEmailsTable } = await getDb();
    const { eq } = await import("drizzle-orm");

    let deleted;
    if (id) {
      [deleted] = await db
        .delete(allowedEmailsTable)
        .where(eq(allowedEmailsTable.id, id))
        .returning();
    } else if (email) {
      [deleted] = await db
        .delete(allowedEmailsTable)
        .where(eq(allowedEmailsTable.email, email.toLowerCase()))
        .returning();
    }

    if (!deleted) {
      return NextResponse.json(
        { error: "Email not found in allowlist" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Email removed from allowlist",
    });
  } catch (error) {
    console.error("Error removing from allowlist:", error);
    return NextResponse.json(
      { error: "An error occurred" },
      { status: 500 }
    );
  }
}
