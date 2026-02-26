import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { validateWebhookUrl } from "@/services/webhook";
import { VALID_EVENTS } from "../shared";

const updateWebhookSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  url: z.string().url().max(2048).optional(),
  secret: z.string().max(255).optional(),
  clearSecret: z.boolean().optional(),
  events: z
    .array(z.enum(VALID_EVENTS))
    .min(1, "At least one event is required")
    .optional(),
  isActive: z.boolean().optional(),
});

/**
 * PUT /api/webhooks/[id] - Update a webhook
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Malformed JSON in request body" },
        { status: 400 }
      );
    }

    const parseResult = updateWebhookSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parseResult.error.issues },
        { status: 400 }
      );
    }

    const updates = parseResult.data;

    // SSRF prevention: validate webhook URL if being updated
    if (updates.url !== undefined) {
      const urlCheck = await validateWebhookUrl(updates.url);
      if (!urlCheck.valid) {
        return NextResponse.json(
          { error: `Invalid webhook URL: ${urlCheck.error}` },
          { status: 400 }
        );
      }
    }

    // Build the set object with only provided fields
    const setValues: Record<string, unknown> = {};
    if (updates.name !== undefined) setValues.name = updates.name;
    if (updates.url !== undefined) setValues.url = updates.url;

    // Secret handling: only update if explicitly provided with a value,
    // or explicitly cleared via clearSecret flag.
    // When secret is undefined/empty, preserve existing secret.
    if (updates.clearSecret === true) {
      setValues.secret = null;
    } else if (updates.secret !== undefined && updates.secret !== "") {
      setValues.secret = updates.secret;
    }
    // If secret is undefined or empty string and clearSecret is not true,
    // we do NOT include it in setValues, preserving the existing secret.

    if (updates.events !== undefined) setValues.events = updates.events;
    if (updates.isActive !== undefined) {
      setValues.isActive = updates.isActive;
      // Reset fail count when re-enabling
      if (updates.isActive) {
        setValues.failCount = 0;
      }
    }

    if (Object.keys(setValues).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    const [webhook] = await db
      .update(schema.webhooks)
      .set(setValues)
      .where(
        and(
          eq(schema.webhooks.id, id),
          eq(schema.webhooks.userId, session.userId)
        )
      )
      .returning({
        id: schema.webhooks.id,
        name: schema.webhooks.name,
        url: schema.webhooks.url,
        events: schema.webhooks.events,
        isActive: schema.webhooks.isActive,
        lastTriggeredAt: schema.webhooks.lastTriggeredAt,
        lastStatus: schema.webhooks.lastStatus,
        failCount: schema.webhooks.failCount,
        createdAt: schema.webhooks.createdAt,
      });

    if (!webhook) {
      return NextResponse.json(
        { error: "Webhook not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ webhook });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Webhook update error");
    return NextResponse.json(
      { error: "Failed to update webhook" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/webhooks/[id] - Delete a webhook
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();

    const [deleted] = await db
      .delete(schema.webhooks)
      .where(
        and(
          eq(schema.webhooks.id, id),
          eq(schema.webhooks.userId, session.userId)
        )
      )
      .returning({ id: schema.webhooks.id });

    if (!deleted) {
      return NextResponse.json(
        { error: "Webhook not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Webhook delete error");
    return NextResponse.json(
      { error: "Failed to delete webhook" },
      { status: 500 }
    );
  }
}
