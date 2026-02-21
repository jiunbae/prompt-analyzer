import crypto from "crypto";
import dns from "node:dns";
import { logger } from "@/lib/logger";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import net from "net";

const MAX_FAIL_COUNT = 10;
const WEBHOOK_TIMEOUT_MS = 10_000;

/**
 * Check whether an IPv4 address string falls within private/internal ranges.
 * Returns an error message if blocked, or null if the address is allowed.
 */
function checkIPv4Private(ip: string): string | null {
  const parts = ip.split(".").map(Number);

  // 127.0.0.0/8 - loopback
  if (parts[0] === 127) return "Loopback addresses are not allowed";

  // 10.0.0.0/8 - private
  if (parts[0] === 10) return "Private network addresses are not allowed";

  // 172.16.0.0/12 - private
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    return "Private network addresses are not allowed";

  // 192.168.0.0/16 - private
  if (parts[0] === 192 && parts[1] === 168)
    return "Private network addresses are not allowed";

  // 169.254.0.0/16 - link-local / cloud metadata
  if (parts[0] === 169 && parts[1] === 254)
    return "Link-local and metadata addresses are not allowed";

  // 0.0.0.0/8
  if (parts[0] === 0) return "Invalid address range";

  return null;
}

/**
 * Check whether an IPv6 address is private/internal.
 * Also handles IPv4-mapped IPv6 (::ffff:x.x.x.x) by extracting and checking the IPv4 part.
 * Returns an error message if blocked, or null if the address is allowed.
 */
function checkIPv6Private(ip: string): string | null {
  const normalized = ip.toLowerCase();

  if (
    normalized === "::1" ||
    normalized === "::0" ||
    normalized === "::" ||
    normalized.startsWith("fe80") ||  // link-local
    normalized.startsWith("fc") ||    // unique local
    normalized.startsWith("fd")       // unique local
  ) {
    return "Private or loopback IPv6 addresses are not allowed";
  }

  // Check for IPv4-mapped IPv6 addresses (::ffff:x.x.x.x)
  const v4MappedMatch = normalized.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4MappedMatch) {
    const mappedV4 = v4MappedMatch[1];
    const v4Error = checkIPv4Private(mappedV4);
    if (v4Error) return v4Error;
  }

  // Also handle the hex form of ::ffff:  e.g. ::ffff:7f00:1 = 127.0.0.1
  const hexMappedMatch = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMappedMatch) {
    const high = parseInt(hexMappedMatch[1], 16);
    const low = parseInt(hexMappedMatch[2], 16);
    const a = (high >> 8) & 0xff;
    const b = high & 0xff;
    const c = (low >> 8) & 0xff;
    const d = low & 0xff;
    const mappedV4 = `${a}.${b}.${c}.${d}`;
    const v4Error = checkIPv4Private(mappedV4);
    if (v4Error) return v4Error;
  }

  return null;
}

/**
 * Check a single resolved IP address against all blocked ranges.
 * Handles IPv4, IPv6, and IPv4-mapped IPv6.
 * Returns an error message if blocked, or null if the address is allowed.
 */
function checkResolvedIP(ip: string): string | null {
  if (net.isIPv4(ip)) {
    return checkIPv4Private(ip);
  }

  if (net.isIPv6(ip)) {
    return checkIPv6Private(ip);
  }

  return null;
}

/**
 * Validate a webhook URL for SSRF prevention.
 * Allows only http/https, blocks localhost, private/internal IPs,
 * link-local, metadata endpoint ranges, and resolves DNS hostnames
 * to prevent SSRF via DNS-based bypasses.
 */
export async function validateWebhookUrl(urlString: string): Promise<{ valid: boolean; error?: string }> {
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

  // If the hostname is a literal IP address, check for private/internal ranges
  if (net.isIPv4(hostname)) {
    const err = checkIPv4Private(hostname);
    if (err) return { valid: false, error: err };
  }

  // Block IPv6 loopback and private ranges (bracket-wrapped in URLs)
  const rawHost = hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (net.isIPv6(rawHost)) {
    const err = checkIPv6Private(rawHost);
    if (err) return { valid: false, error: err };
  }

  // DNS resolution check: resolve hostname and verify all IPs are public
  // This prevents bypasses like evil.example.com -> 127.0.0.1
  if (!net.isIPv4(hostname) && !net.isIPv6(rawHost)) {
    try {
      const { address: resolvedIP } = await dns.promises.lookup(hostname, { all: false });
      const ipErr = checkResolvedIP(resolvedIP);
      if (ipErr) {
        return { valid: false, error: `DNS resolved to blocked address: ${ipErr}` };
      }
    } catch (dnsError) {
      return { valid: false, error: "DNS resolution failed for hostname" };
    }

    // Also check all A and AAAA records to prevent selective resolution attacks
    const allIPs: string[] = [];
    try {
      const ipv4Addrs = await dns.promises.resolve4(hostname);
      allIPs.push(...ipv4Addrs);
    } catch {
      // No A records is fine
    }
    try {
      const ipv6Addrs = await dns.promises.resolve6(hostname);
      allIPs.push(...ipv6Addrs);
    } catch {
      // No AAAA records is fine
    }

    for (const ip of allIPs) {
      const ipErr = checkResolvedIP(ip);
      if (ipErr) {
        return { valid: false, error: `DNS resolved to blocked address: ${ipErr}` };
      }
    }
  }

  return { valid: true };
}

/**
 * Re-resolve DNS and validate IPs right before fetch to mitigate TOCTOU / DNS rebinding.
 * Returns an error message if blocked, or null if safe to proceed.
 */
async function preFlightDnsCheck(urlString: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return "Invalid URL format";
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");

  // Skip if hostname is already a literal IP (already checked by validateWebhookUrl)
  if (net.isIPv4(hostname) || net.isIPv6(hostname)) {
    return null;
  }

  try {
    const { address: resolvedIP } = await dns.promises.lookup(hostname, { all: false });
    const ipErr = checkResolvedIP(resolvedIP);
    if (ipErr) {
      return `Pre-flight DNS resolved to blocked address: ${ipErr}`;
    }
  } catch {
    return "Pre-flight DNS resolution failed";
  }

  // Check all records
  const allIPs: string[] = [];
  try {
    const ipv4Addrs = await dns.promises.resolve4(hostname);
    allIPs.push(...ipv4Addrs);
  } catch {
    // No A records
  }
  try {
    const ipv6Addrs = await dns.promises.resolve6(hostname);
    allIPs.push(...ipv6Addrs);
  } catch {
    // No AAAA records
  }

  for (const ip of allIPs) {
    const ipErr = checkResolvedIP(ip);
    if (ipErr) {
      return `Pre-flight DNS resolved to blocked address: ${ipErr}`;
    }
  }

  return null;
}

/**
 * Sign a payload using HMAC-SHA256
 */
function signPayload(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
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
  const { eq, and, sql } = await import("drizzle-orm");

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
          const urlCheck = await validateWebhookUrl(webhook.url);
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

          // Pre-flight DNS re-check right before fetch to mitigate TOCTOU / DNS rebinding
          const preFlightErr = await preFlightDnsCheck(webhook.url);
          if (preFlightErr) {
            throw new Error(`SSRF blocked (pre-flight): ${preFlightErr}`);
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
}

/**
 * Send a test event to a specific webhook.
 * Returns the delivery result for immediate feedback.
 */
export async function sendTestWebhook(
  webhookId: string,
  userId: string
): Promise<{ success: boolean; statusCode: number | null; duration: number; error?: string }> {
  const { eq, and } = await import("drizzle-orm");

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
    const urlCheck = await validateWebhookUrl(webhook.url);
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
      // Pre-flight DNS re-check right before fetch to mitigate TOCTOU / DNS rebinding
      const preFlightErr = await preFlightDnsCheck(webhook.url);
      if (preFlightErr) {
        return { success: false, statusCode: null, duration: 0, error: `URL blocked (pre-flight): ${preFlightErr}` };
      }

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
}
