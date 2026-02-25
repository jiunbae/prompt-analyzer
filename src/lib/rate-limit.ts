/**
 * Simple in-memory sliding-window rate limiter.
 * NOT suitable for multi-instance deployments — use Redis-backed limiter if scaling horizontally.
 */

interface RateLimitEntry {
  timestamps: number[];
}

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Create a rate limiter with its own isolated store and cleanup timer.
 * Each limiter has independent tracking so auth limits don't affect search limits.
 */
export function createRateLimiter(maxRequests: number, windowMs: number) {
  const store = new Map<string, RateLimitEntry>();
  let lastCleanup = Date.now();

  function cleanup() {
    const now = Date.now();
    if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
    lastCleanup = now;

    const cutoff = now - windowMs;
    for (const [key, entry] of store) {
      entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
      if (entry.timestamps.length === 0) {
        store.delete(key);
      }
    }
  }

  return (key: string): RateLimitResult => {
    const now = Date.now();
    cleanup();

    let entry = store.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      store.set(key, entry);
    }

    const cutoff = now - windowMs;
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

    if (entry.timestamps.length >= maxRequests) {
      const oldest = entry.timestamps[0];
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: oldest + windowMs - now,
      };
    }

    entry.timestamps.push(now);
    return {
      allowed: true,
      remaining: maxRequests - entry.timestamps.length,
      retryAfterMs: 0,
    };
  };
}

/** Rate limiter presets — each has its own isolated store and cleanup timer */
export const rateLimiters = {
  /** Auth endpoints: 10 requests per minute */
  auth: createRateLimiter(10, 60 * 1000),
  /** Search endpoints: 30 requests per minute */
  search: createRateLimiter(30, 60 * 1000),
  /** Webhook test: 5 requests per minute */
  webhookTest: createRateLimiter(5, 60 * 1000),
  /** General API: 100 requests per minute */
  api: createRateLimiter(100, 60 * 1000),
  /** LLM-backed endpoints: 10 requests per minute (expensive) */
  llm: createRateLimiter(10, 60 * 1000),
};
