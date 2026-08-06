import type { IncomingMessage } from "node:http";

const DEFAULT_PRODUCTION_ORIGINS = ["https://muditam.com", "https://www.muditam.com"];

export function allowedStorefrontOrigins(nodeEnv = process.env.NODE_ENV): Set<string> {
  const configured = (process.env.MUDITAM_COMMERCE_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const origins = configured.length ? configured : DEFAULT_PRODUCTION_ORIGINS;
  if (nodeEnv !== "production") origins.push("http://localhost:4174", "http://127.0.0.1:4174");
  return new Set(origins);
}

export function allowedStorefrontOrigin(origin: string | undefined, nodeEnv = process.env.NODE_ENV): string | null {
  if (!origin) return null;
  return allowedStorefrontOrigins(nodeEnv).has(origin) ? origin : null;
}

export function storefrontClientKey(request: IncomingMessage, sessionId: string): string {
  const forwarded = request.headers["x-forwarded-for"];
  const address = typeof forwarded === "string"
    ? forwarded.split(",")[0]?.trim()
    : request.socket.remoteAddress;
  return `${address ?? "unknown"}:${sessionId}`;
}

interface RateBucket {
  count: number;
  resetsAt: number;
}

export class StorefrontRateLimiter {
  readonly #buckets = new Map<string, RateBucket>();

  constructor(
    readonly limit = 20,
    readonly windowMs = 60_000,
  ) {}

  allow(key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    const existing = this.#buckets.get(key);
    if (!existing || existing.resetsAt <= now) {
      this.#buckets.set(key, { count: 1, resetsAt: now + this.windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (existing.count >= this.limit) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((existing.resetsAt - now) / 1000)) };
    }
    existing.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
