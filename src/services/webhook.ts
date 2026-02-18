import crypto from "crypto";
import { logger } from "@/lib/logger";
import net from "net";

const MAX_FAIL_COUNT = 10;
const WEBHOOK_TIMEOUT_MS = 10_000;

/**
 * Validate a webhook URL for SSRF prevention.
 * Allows only http/https, blocks localhost, private/internal IPs,
 * link-local, and metadata endpoint ranges.
 */
export function validateWebhookUrl(urlString: string): { valid: boolean; error?: string } {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }

  // Only allow http and https
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false, error: "Only http and https protocols are allowed" };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost variants
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    hostname === "0.0.0.0"
  ) {
    return { valid: false, error: "Localhost URLs are not allowed" };
  }

  // If the hostname is an IP address, check for private/internal ranges
  if (net.isIPv4(hostname)) {
    const parts = hostname.split(".").map(Number);

    // 127.0.0.0/8 - loopback
    if (parts[0] === 127) {
      return { valid: false, error: "Loopback addresses are not allowed" };
    }

    // 10.0.0.0/8 - private
    if (parts[0] === 10) {
      return { valid: false, error: "Private network addresses are not allowed" };
    }

    // 172.16.0.0/12 - private
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
      return { valid: false, error: "Private network addresses are not allowed" };
    }

    // 192.168.0.0/16 - private
    if (parts[0] === 192 && parts[1] === 168) {
      return { valid: false, error: "Private network addresses are not allowed" };
    }

    // 169.254.0.0/16 - link-local / cloud metadata
    if (parts[0] === 169 && parts[1] === 254) {
      return { valid: false, error: "Link-local and metadata addresses are not allowed" };
    }

    // 0.0.0.0/8
    if (parts[0] === 0) {
      return { valid: false, error: "Invalid address range" };
    }
  }

  // Block IPv6 loopback and private ranges (bracket-wrapped in URLs)
  const rawHost = hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (net.isIPv6(rawHost)) {
    const normalized = rawHost.toLowerCase();
    if (
      normalized === "::1" ||
      normalized === "::0" ||
      normalized === "::" ||
      normalized.startsWith("fe80") ||  // link-local
      normalized.startsWith("fc") ||    // unique local
      normalized.startsWith("fd")       // unique local
    ) {
      return { valid: false, error: "Private or loopback IPv6 addresses are not allowed" };
    }
  }

  return { valid: true };
}

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
          // SSRF check before dispatch
          const urlCheck = validateWebhookUrl(webhook.url);
          if (!urlCheck.valid) {
            throw new Error(`SSRF blocked: ${urlCheck.error}`);
          }

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
            redirect: "error",  // Disable redirects to prevent SSRF via redirect
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

          // Update webhook status based on response (atomic operations)
          if (statusCode >= 200 && statusCode < 300) {
            // Success: reset fail count atomically
            await db
              .update(schema.webhooks)
              .set({
                lastTriggeredAt: new Date(),
                lastStatus: statusCode,
                failCount: 0,
              })
              .where(eq(schema.webhooks.id, webhook.id));
          } else {
            // Non-2xx: increment fail count atomically and derive is_active from DB state
            await db.execute(
              sql`UPDATE webhooks SET
                last_triggered_at = NOW(),
                last_status = ${statusCode},
                fail_count = fail_count + 1,
                is_active = CASE WHEN fail_count + 1 >= ${MAX_FAIL_COUNT} THEN false ELSE is_active END
              WHERE id = ${webhook.id}`
            );

            // Check if we just hit the threshold for logging purposes
            const [updated] = await db
              .select({ failCount: schema.webhooks.failCount })
              .from(schema.webhooks)
              .where(eq(schema.webhooks.id, webhook.id))
              .limit(1);

            if (updated && (updated.failCount ?? 0) >= MAX_FAIL_COUNT) {
              logger.warn(
                { webhookId: webhook.id, failCount: updated.failCount },
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

          // Increment fail count atomically and derive is_active from DB state
          await db.execute(
            sql`UPDATE webhooks SET
              last_triggered_at = NOW(),
              last_status = NULL,
              fail_count = fail_count + 1,
              is_active = CASE WHEN fail_count + 1 >= ${MAX_FAIL_COUNT} THEN false ELSE is_active END
            WHERE id = ${webhook.id}`
          );

          // Check if we just hit the threshold for logging purposes
          const [updated] = await db
            .select({ failCount: schema.webhooks.failCount })
            .from(schema.webhooks)
            .where(eq(schema.webhooks.id, webhook.id))
            .limit(1);

          if (updated && (updated.failCount ?? 0) >= MAX_FAIL_COUNT) {
            logger.warn(
              { webhookId: webhook.id, failCount: updated.failCount },
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

    // SSRF check before test dispatch
    const urlCheck = validateWebhookUrl(webhook.url);
    if (!urlCheck.valid) {
      return { success: false, statusCode: null, duration: 0, error: `URL blocked: ${urlCheck.error}` };
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
        redirect: "error",  // Disable redirects to prevent SSRF via redirect
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
