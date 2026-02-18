import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
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
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;
    if (!sessionToken) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const session = parseSessionToken(sessionToken);
    if (!session) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const rawLimit = parseInt(searchParams.get("limit") ?? "20", 10);
    const limit = Number.isNaN(rawLimit) ? 20 : Math.max(1, Math.min(rawLimit, 100));

    const client = postgres(process.env.DATABASE_URL!);
    const db = drizzle(client, { schema });

    try {
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
    } finally {
      await client.end();
    }
  } catch (error) {
    console.error("Webhook logs error:", error);
    return NextResponse.json(
      { error: "Failed to fetch webhook logs" },
      { status: 500 }
    );
  }
}
