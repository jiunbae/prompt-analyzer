import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, or, sql } from "drizzle-orm";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { z } from "zod";

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const renderBodySchema = z.object({
  values: z.record(z.string(), z.string()).optional().default({}),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();

    const body = await request.json();
    const parsed = renderBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { values } = parsed.data;

    const [tmpl] = await db
      .select()
      .from(schema.promptTemplates)
      .where(
        and(
          eq(schema.promptTemplates.id, id),
          or(
            eq(schema.promptTemplates.userId, session.userId),
            eq(schema.promptTemplates.isPublic, true)
          )
        )
      )
      .limit(1);

    if (!tmpl) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    // Render template by replacing {{variable}} with values
    let rendered = tmpl.template;
    const vars = (tmpl.variables as Array<{ name: string; default?: string }>) || [];

    for (const v of vars) {
      const value = values?.[v.name] ?? v.default ?? "";
      const regex = new RegExp(`\\{\\{\\s*${escapeRegExp(v.name)}\\s*\\}\\}`, "g");
      rendered = rendered.replace(regex, () => value);
    }

    // Also replace any remaining {{placeholders}} that weren't in the variables list
    if (values) {
      for (const [key, val] of Object.entries(values)) {
        const regex = new RegExp(`\\{\\{\\s*${escapeRegExp(key)}\\s*\\}\\}`, "g");
        rendered = rendered.replace(regex, () => String(val));
      }
    }

    // Increment usage count
    await db
      .update(schema.promptTemplates)
      .set({ usageCount: sql`${schema.promptTemplates.usageCount} + 1` })
      .where(eq(schema.promptTemplates.id, id));

    return NextResponse.json({ rendered });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("Templates render error:", error);
    return NextResponse.json({ error: "Failed to render template" }, { status: 500 });
  }
}
