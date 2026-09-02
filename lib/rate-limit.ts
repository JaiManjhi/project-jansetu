/**
 * Minimal in-memory rate limiter.
 *
 * ARCHITECTURE.md §8 calls for exactly this on the public routes and says an
 * IP-based in-memory limiter is sufficient for hackathon scope.
 *
 * ⚠ Known limitation, stated rather than hidden: this is per-process memory.
 * On Vercel each serverless instance keeps its own counter, so the effective
 * limit is (instances × limit) and it resets whenever an instance is recycled.
 * It stops casual abuse — someone holding down an upvote button — and nothing
 * more. A real limiter needs shared storage; that is a roadmap item, not a
 * hackathon one.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Bounded so a flood of distinct keys cannot grow the map without limit.
const MAX_KEYS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_KEYS) {
      // Cheapest possible eviction: drop everything already expired, and if
      // that frees nothing, clear the map. Correctness here is "does not leak",
      // not "perfectly fair".
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
      if (buckets.size >= MAX_KEYS) buckets.clear();
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count, retryAfterSeconds: 0 };
}

/**
 * Best-effort client IP. Behind Vercel the useful value is the first entry of
 * x-forwarded-for; the rest is proxy chain. Falls back to a constant, which
 * degrades to a global limit rather than to no limit at all.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip") || "unknown";
}
