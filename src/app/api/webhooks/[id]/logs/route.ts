import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/webhooks/[id]/logs - Get recent delivery logs for a webhook
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();

    const { searchParams } = new URL(request.url);
    const rawLimit = parseInt(searchParams.get("limit") ?? "20", 10);
    const limit = Number.isNaN(rawLimit) ? 20 : Math.max(1, Math.min(rawLimit, 100));

    // Verify webhook belongs to user
    const [webhook] = await db
      .select({ id: schema.webhooks.id })
      .from(schema.webhooks)
      .where(
        and(
          eq(schema.webhooks.id, id),
          eq(schema.webhooks.userId, session.userId)
        )
      )
      .limit(1);

    if (!webhook) {
      return NextResponse.json(
        { error: "Webhook not found" },
        { status: 404 }
      );
    }

    const logs = await db
      .select({
        id: schema.webhookLogs.id,
        event: schema.webhookLogs.event,
        statusCode: schema.webhookLogs.statusCode,
        responseBody: schema.webhookLogs.responseBody,
        duration: schema.webhookLogs.duration,
        createdAt: schema.webhookLogs.createdAt,
      })
      .from(schema.webhookLogs)
      .where(eq(schema.webhookLogs.webhookId, id))
      .orderBy(desc(schema.webhookLogs.createdAt))
      .limit(limit);

    return NextResponse.json({ logs });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("Webhook logs error:", error);
    return NextResponse.json(
      { error: "Failed to fetch webhook logs" },
      { status: 500 }
    );
  }
}
