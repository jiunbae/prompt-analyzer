import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";
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

const updateTemplateSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  template: z.string().min(1).max(50000).optional(),
  variables: z.array(templateVariableSchema).max(50).optional(),
  category: z.enum(CATEGORIES).nullable().optional(),
  isPublic: z.boolean().optional(),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();

    const body = await request.json();
    const parsed = updateTemplateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { title, description, template, variables, category, isPublic } = parsed.data;

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

    if (!updated) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    return NextResponse.json({ template: updated });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
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
    const session = await requireAuth();

    const deleted = await db
      .delete(schema.promptTemplates)
      .where(
        and(
          eq(schema.promptTemplates.id, id),
          eq(schema.promptTemplates.userId, session.userId)
        )
      )
      .returning({ id: schema.promptTemplates.id });

    if (deleted.length === 0) {
      return NextResponse.json({ error: "Template not found or not owned by you" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
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
    const session = await requireAuth();

    const [tmpl] = await db
      .select()
      .from(schema.promptTemplates)
      .where(eq(schema.promptTemplates.id, id))
      .limit(1);

    if (!tmpl) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    // Only allow access to own templates or public ones
    if (tmpl.userId !== session.userId && !tmpl.isPublic) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    return NextResponse.json({ template: tmpl });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("Templates GET [id] error:", error);
    return NextResponse.json({ error: "Failed to fetch template" }, { status: 500 });
  }
}
