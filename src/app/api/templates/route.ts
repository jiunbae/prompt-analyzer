import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, or, and, sql } from "drizzle-orm";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { z } from "zod";

const CATEGORIES = [
  "debugging",
  "code-review",
  "feature",
  "refactoring",
  "testing",
  "documentation",
  "other",
] as const;

const templateVariableSchema = z.object({
  name: z.string().min(1).max(100).regex(/^\w+$/, "Variable names must be alphanumeric/underscore only"),
  default: z.string().max(1000).default(""),
  description: z.string().max(500).default(""),
});

const createTemplateSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
  template: z.string().min(1).max(50000),
  variables: z.array(templateVariableSchema).max(50).default([]),
  category: z.enum(CATEGORIES).nullable().optional(),
  isPublic: z.boolean().default(false),
});

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();

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

    return NextResponse.json({ templates });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("Templates GET error:", error);
    return NextResponse.json({ error: "Failed to fetch templates" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();

    const body = await request.json();
    const parsed = createTemplateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { title, description, template, variables, category, isPublic } = parsed.data;

    const [created] = await db
      .insert(schema.promptTemplates)
      .values({
        userId: session.userId,
        title,
        description: description || null,
        template,
        variables,
        category: category || null,
        isPublic,
      })
      .returning();

    return NextResponse.json({ template: created }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("Templates POST error:", error);
    return NextResponse.json({ error: "Failed to create template" }, { status: 500 });
  }
}
