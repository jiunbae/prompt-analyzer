import { NextRequest, NextResponse } from "next/server";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME } from "@/lib/auth";

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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { title, description, template, variables, category, isPublic } = body;

    const { db, client } = getDb();

    const [updated] = await db
      .update(schema.promptTemplates)
      .set({
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(template !== undefined && { template }),
        ...(variables !== undefined && { variables }),
        ...(category !== undefined && { category }),
        ...(isPublic !== undefined && { isPublic }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.promptTemplates.id, id),
          eq(schema.promptTemplates.userId, session.userId)
        )
      )
      .returning();

    await client.end();

    if (!updated) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    return NextResponse.json({ template: updated });
  } catch (error) {
    console.error("Templates PUT error:", error);
    return NextResponse.json({ error: "Failed to update template" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { db, client } = getDb();

    await db
      .delete(schema.promptTemplates)
      .where(
        and(
          eq(schema.promptTemplates.id, id),
          eq(schema.promptTemplates.userId, session.userId)
        )
      );

    await client.end();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Templates DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete template" }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { db, client } = getDb();

    const [tmpl] = await db
      .select()
      .from(schema.promptTemplates)
      .where(eq(schema.promptTemplates.id, id))
      .limit(1);

    await client.end();

    if (!tmpl) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    // Only allow access to own templates or public ones
    if (tmpl.userId !== session.userId && !tmpl.isPublic) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    return NextResponse.json({ template: tmpl });
  } catch (error) {
    console.error("Templates GET [id] error:", error);
    return NextResponse.json({ error: "Failed to fetch template" }, { status: 500 });
  }
}
