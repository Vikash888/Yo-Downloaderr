import type { NextRequest } from "next/server";

type Bucket = { count: number; resetAt: number };
type RateStore = Map<string, Bucket>;

const globalForRateLimit = globalThis as typeof globalThis & { __yoRateLimits?: RateStore };
const store = globalForRateLimit.__yoRateLimits ?? new Map<string, Bucket>();
globalForRateLimit.__yoRateLimits = store;

export function rateLimit(request: NextRequest, scope: string, limit: number, windowMs: number): { allowed: boolean; retryAfter: number } {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const identity = forwarded || request.headers.get("x-real-ip") || "local";
  const key = `${scope}:${identity}`;
  const now = Date.now();
  const current = store.get(key);
  if (!current || current.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }
  current.count += 1;
  if (store.size > 5000) {
    for (const [storedKey, bucket] of store) if (bucket.resetAt <= now) store.delete(storedKey);
  }
  return {
    allowed: current.count <= limit,
    retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}
