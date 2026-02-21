import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { validateWebhookUrl } from "@/services/webhook";

export const dynamic = "force-dynamic";

const VALID_EVENTS = [
  "prompt.created",
  "prompt.scored",
  "session.started",
  "session.ended",
  "sync.completed",
] as const;

const createWebhookSchema = z.object({
  name: z.string().min(1).max(255),
  url: z.string().url().max(2048),
  secret: z.string().max(255).optional(),
  events: z
    .array(z.enum(VALID_EVENTS))
    .min(1, "At least one event is required")
    .default(["prompt.created"]),
});

/**
 * GET /api/webhooks - List all webhooks for the current user
 */
export async function GET() {
  try {
    const session = await requireAuth();

    const webhooks = await db
      .select({
        id: schema.webhooks.id,
        name: schema.webhooks.name,
        url: schema.webhooks.url,
        events: schema.webhooks.events,
        isActive: schema.webhooks.isActive,
        lastTriggeredAt: schema.webhooks.lastTriggeredAt,
        lastStatus: schema.webhooks.lastStatus,
        failCount: schema.webhooks.failCount,
        createdAt: schema.webhooks.createdAt,
      })
      .from(schema.webhooks)
      .where(eq(schema.webhooks.userId, session.userId))
      .orderBy(schema.webhooks.createdAt);

    return NextResponse.json({ webhooks });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("Webhooks list error:", error);
    return NextResponse.json(
      { error: "Failed to fetch webhooks" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/webhooks - Create a new webhook
 */
export async function POST(request: NextRequest) {
  try {
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

    const parseResult = createWebhookSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parseResult.error.issues },
        { status: 400 }
      );
    }

    const { name, url, secret, events } = parseResult.data;

    // SSRF prevention: validate webhook URL
    const urlCheck = await validateWebhookUrl(url);
    if (!urlCheck.valid) {
      return NextResponse.json(
        { error: `Invalid webhook URL: ${urlCheck.error}` },
        { status: 400 }
      );
    }

    const [webhook] = await db
      .insert(schema.webhooks)
      .values({
        userId: session.userId,
        name,
        url,
        secret: secret || null,
        events,
        isActive: true,
        failCount: 0,
      })
      .returning({
        id: schema.webhooks.id,
        name: schema.webhooks.name,
        url: schema.webhooks.url,
        events: schema.webhooks.events,
        isActive: schema.webhooks.isActive,
        createdAt: schema.webhooks.createdAt,
      });

    return NextResponse.json({ webhook }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("Webhook create error:", error);
    return NextResponse.json(
      { error: "Failed to create webhook" },
      { status: 500 }
    );
  }
}
