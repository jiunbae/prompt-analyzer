import { NextRequest, NextResponse } from "next/server";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { eq, or, and, sql } from "drizzle-orm";
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

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { db, client } = getDb();
    const url = new URL(request.url);
    const category = url.searchParams.get("category");

    const conditions = [
      or(
        eq(schema.promptTemplates.userId, session.userId),
        eq(schema.promptTemplates.isPublic, true)
      ),
    ];

    if (category) {
      conditions.push(eq(schema.promptTemplates.category, category));
    }

    const templates = await db
      .select()
      .from(schema.promptTemplates)
      .where(and(...conditions))
      .orderBy(sql`${schema.promptTemplates.updatedAt} DESC`);

    await client.end();

    return NextResponse.json({ templates });
  } catch (error) {
    console.error("Templates GET error:", error);
    return NextResponse.json({ error: "Failed to fetch templates" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { title, description, template, variables, category, isPublic } = body;

    if (!title || !template) {
      return NextResponse.json(
        { error: "Title and template are required" },
        { status: 400 }
      );
    }

    const { db, client } = getDb();

    const [created] = await db
      .insert(schema.promptTemplates)
      .values({
        userId: session.userId,
        title,
        description: description || null,
        template,
        variables: variables || [],
        category: category || null,
        isPublic: isPublic ?? false,
      })
      .returning();

    await client.end();

    return NextResponse.json({ template: created }, { status: 201 });
  } catch (error) {
    console.error("Templates POST error:", error);
    return NextResponse.json({ error: "Failed to create template" }, { status: 500 });
  }
}
