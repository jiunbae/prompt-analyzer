import { NextRequest, NextResponse } from "next/server";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import crypto from "crypto";

function getDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL not configured");
  const client = postgres(connectionString);
  return { db: drizzle(client, { schema }), client };
}

async function getSession() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!sessionToken) return null;
  return parseSessionToken(sessionToken);
}

// POST /api/share - Create a share link
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { promptId, expiresIn } = body; // expiresIn in hours, null = never

    if (!promptId) {
      return NextResponse.json({ error: "promptId is required" }, { status: 400 });
    }

    const { db, client } = getDb();

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
      await client.end();
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

    await client.end();

    return NextResponse.json({ shared }, { status: 201 });
  } catch (error) {
    console.error("Share POST error:", error);
    return NextResponse.json({ error: "Failed to create share link" }, { status: 500 });
  }
}

// GET /api/share - List user's shared links
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { db, client } = getDb();

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

    await client.end();

    return NextResponse.json({ shares });
  } catch (error) {
    console.error("Share GET error:", error);
    return NextResponse.json({ error: "Failed to fetch shares" }, { status: 500 });
  }
}

// DELETE /api/share - Revoke a share link (id in body or query)
export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const { db, client } = getDb();

    await db
      .update(schema.sharedPrompts)
      .set({ isActive: false })
      .where(
        and(
          eq(schema.sharedPrompts.id, id),
          eq(schema.sharedPrompts.userId, session.userId)
        )
      );

    await client.end();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Share DELETE error:", error);
    return NextResponse.json({ error: "Failed to revoke share" }, { status: 500 });
  }
}
