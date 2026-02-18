import crypto from "crypto";
import { logger } from "@/lib/logger";

const MAX_FAIL_COUNT = 10;
const WEBHOOK_TIMEOUT_MS = 10_000;

/**
 * Sign a payload using HMAC-SHA256
 */
function signPayload(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Get a database connection for webhook operations
 */
async function getDb() {
  const postgres = (await import("postgres")).default;
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const schema = await import("@/db/schema");

  const client = postgres(process.env.DATABASE_URL!);
  const db = drizzle(client, { schema });

  return { db, schema, client };
}

/**
 * Dispatch a webhook event to all active webhooks for a user.
 *
 * Queries active webhooks subscribed to the given event, POSTs the payload
 * to each URL with HMAC-SHA256 signing, logs results, and auto-disables
 * webhooks after MAX_FAIL_COUNT consecutive failures.
 */
export async function dispatchWebhook(
  userId: string,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  const { db, schema, client } = await getDb();
  const { eq, and, sql } = await import("drizzle-orm");

  try {
    // Find all active webhooks for this user that subscribe to this event
    const activeWebhooks = await db
      .select()
      .from(schema.webhooks)
      .where(
        and(
          eq(schema.webhooks.userId, userId),
          eq(schema.webhooks.isActive, true),
          sql`${event} = ANY(${schema.webhooks.events})`
        )
      );

    if (activeWebhooks.length === 0) return;

    const deliveryPayload = {
      event,
      timestamp: new Date().toISOString(),
      data: payload,
    };

    const bodyString = JSON.stringify(deliveryPayload);

    // Fire all webhooks concurrently
    await Promise.allSettled(
      activeWebhooks.map(async (webhook) => {
        const startTime = Date.now();
        let statusCode: number | null = null;
        let responseBody: string | null = null;

        try {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "User-Agent": "oh-my-prompt/webhooks",
            "X-Webhook-Event": event,
            "X-Webhook-Id": webhook.id,
          };

          // Add HMAC signature if secret is configured
          if (webhook.secret) {
            const signature = signPayload(bodyString, webhook.secret);
            headers["X-Webhook-Signature"] = `sha256=${signature}`;
          }

          const controller = new AbortController();
          const timeoutId = setTimeout(
            () => controller.abort(),
            WEBHOOK_TIMEOUT_MS
          );

          const response = await fetch(webhook.url, {
            method: "POST",
            headers,
            body: bodyString,
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          statusCode = response.status;
          responseBody = await response.text().catch(() => null);

          // Truncate response body for storage
          if (responseBody && responseBody.length > 4096) {
            responseBody = responseBody.slice(0, 4096) + "...(truncated)";
          }

          const duration = Date.now() - startTime;

          // Log the delivery
          await db.insert(schema.webhookLogs).values({
            webhookId: webhook.id,
            event,
            payload: deliveryPayload,
            statusCode,
            responseBody,
            duration,
          });

          // Update webhook status based on response
          if (statusCode >= 200 && statusCode < 300) {
            // Success: reset fail count
            await db
              .update(schema.webhooks)
              .set({
                lastTriggeredAt: new Date(),
                lastStatus: statusCode,
                failCount: 0,
              })
              .where(eq(schema.webhooks.id, webhook.id));
          } else {
            // Non-2xx: increment fail count
            const newFailCount = (webhook.failCount ?? 0) + 1;
            await db
              .update(schema.webhooks)
              .set({
                lastTriggeredAt: new Date(),
                lastStatus: statusCode,
                failCount: newFailCount,
                isActive: newFailCount >= MAX_FAIL_COUNT ? false : webhook.isActive,
              })
              .where(eq(schema.webhooks.id, webhook.id));

            if (newFailCount >= MAX_FAIL_COUNT) {
              logger.warn(
                { webhookId: webhook.id, failCount: newFailCount },
                "Webhook auto-disabled after repeated failures"
              );
            }
          }
        } catch (error) {
          const duration = Date.now() - startTime;
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";

          // Log the failed delivery
          await db.insert(schema.webhookLogs).values({
            webhookId: webhook.id,
            event,
            payload: deliveryPayload,
            statusCode: null,
            responseBody: `Error: ${errorMessage}`,
            duration,
          });

          // Increment fail count
          const newFailCount = (webhook.failCount ?? 0) + 1;
          await db
            .update(schema.webhooks)
            .set({
              lastTriggeredAt: new Date(),
              lastStatus: null,
              failCount: newFailCount,
              isActive: newFailCount >= MAX_FAIL_COUNT ? false : webhook.isActive,
            })
            .where(eq(schema.webhooks.id, webhook.id));

          if (newFailCount >= MAX_FAIL_COUNT) {
            logger.warn(
              { webhookId: webhook.id, failCount: newFailCount },
              "Webhook auto-disabled after repeated failures"
            );
          }

          logger.error(
            { error, webhookId: webhook.id, url: webhook.url },
            "Webhook delivery failed"
          );
        }
      })
    );
  } finally {
    await client.end();
  }
}

/**
 * Send a test event to a specific webhook.
 * Returns the delivery result for immediate feedback.
 */
export async function sendTestWebhook(
  webhookId: string,
  userId: string
): Promise<{ success: boolean; statusCode: number | null; duration: number; error?: string }> {
  const { db, schema, client } = await getDb();
  const { eq, and } = await import("drizzle-orm");

  try {
    const [webhook] = await db
      .select()
      .from(schema.webhooks)
      .where(
        and(
          eq(schema.webhooks.id, webhookId),
          eq(schema.webhooks.userId, userId)
        )
      )
      .limit(1);

    if (!webhook) {
      return { success: false, statusCode: null, duration: 0, error: "Webhook not found" };
    }

    const testPayload = {
      event: "webhook.test",
      timestamp: new Date().toISOString(),
      data: {
        message: "This is a test webhook delivery from oh-my-prompt",
        webhookId: webhook.id,
        webhookName: webhook.name,
      },
    };

    const bodyString = JSON.stringify(testPayload);
    const startTime = Date.now();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "oh-my-prompt/webhooks",
      "X-Webhook-Event": "webhook.test",
      "X-Webhook-Id": webhook.id,
    };

    if (webhook.secret) {
      const signature = signPayload(bodyString, webhook.secret);
      headers["X-Webhook-Signature"] = `sha256=${signature}`;
    }

    let statusCode: number | null = null;
    let responseBody: string | null = null;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

      const response = await fetch(webhook.url, {
        method: "POST",
        headers,
        body: bodyString,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      statusCode = response.status;
      responseBody = await response.text().catch(() => null);

      if (responseBody && responseBody.length > 4096) {
        responseBody = responseBody.slice(0, 4096) + "...(truncated)";
      }
    } catch (error) {
      responseBody = `Error: ${error instanceof Error ? error.message : "Unknown error"}`;
    }

    const duration = Date.now() - startTime;

    // Log the test delivery
    await db.insert(schema.webhookLogs).values({
      webhookId: webhook.id,
      event: "webhook.test",
      payload: testPayload,
      statusCode,
      responseBody,
      duration,
    });

    const success = statusCode !== null && statusCode >= 200 && statusCode < 300;

    return {
      success,
      statusCode,
      duration,
      error: success ? undefined : (responseBody ?? "Request failed"),
    };
  } finally {
    await client.end();
  }
}
