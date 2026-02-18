import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

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
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;
    if (!sessionToken) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const session = parseSessionToken(sessionToken);
    if (!session) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const client = postgres(process.env.DATABASE_URL!);
    const db = drizzle(client, { schema });

    try {
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
    } finally {
      await client.end();
    }
  } catch (error) {
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
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;
    if (!sessionToken) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const session = parseSessionToken(sessionToken);
    if (!session) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const body = await request.json();
    const parseResult = createWebhookSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parseResult.error.issues },
        { status: 400 }
      );
    }

    const { name, url, secret, events } = parseResult.data;

    const client = postgres(process.env.DATABASE_URL!);
    const db = drizzle(client, { schema });

    try {
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
    } finally {
      await client.end();
    }
  } catch (error) {
    console.error("Webhook create error:", error);
    return NextResponse.json(
      { error: "Failed to create webhook" },
      { status: 500 }
    );
  }
}
