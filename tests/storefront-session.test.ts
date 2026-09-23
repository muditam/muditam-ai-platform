import { describe, expect, it } from "vitest";
import {
  bearerToken,
  createStorefrontSession,
  verifyStorefrontSession,
} from "../src/commerce/storefront-session.js";
import {
  allowedStorefrontOrigin,
  StorefrontRateLimiter,
} from "../src/commerce/storefront-policy.js";

const secret = "test-storefront-session-secret-with-32-characters";

describe("storefront commerce sessions", () => {
  it("creates and verifies a scoped anonymous session", () => {
    const created = createStorefrontSession({ secret, now: 1_000, ttlSeconds: 600 });
    const verified = verifyStorefrontSession(created.token, { secret, now: 1_100 });

    expect(verified?.conversationId).toBe(created.conversationId);
    expect(verified?.visitorId).toBe(created.visitorId);
    expect(verified?.expiresAt).toBe(1_600);
  });

  it("rejects tampered and expired tokens", () => {
    const created = createStorefrontSession({ secret, now: 1_000, ttlSeconds: 600 });
    const replacement = created.token.endsWith("a") ? "b" : "a";
    const tampered = `${created.token.slice(0, -1)}${replacement}`;

    expect(verifyStorefrontSession(tampered, { secret, now: 1_100 })).toBeNull();
    expect(verifyStorefrontSession(created.token, { secret, now: 1_600 })).toBeNull();
  });

  it("parses only a correctly formed bearer token", () => {
    expect(bearerToken("Bearer abc.def")).toBe("abc.def");
    expect(bearerToken("Basic abc.def")).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });

  it("allows only configured storefront origins", () => {
    const previous = process.env.MUDITAM_COMMERCE_ALLOWED_ORIGINS;
    process.env.MUDITAM_COMMERCE_ALLOWED_ORIGINS = "https://muditam.com,https://preview.muditam.com";
    try {
      expect(allowedStorefrontOrigin("https://muditam.com", "production")).toBe("https://muditam.com");
      expect(allowedStorefrontOrigin("https://preview.muditam.com", "production")).toBe("https://preview.muditam.com");
      expect(allowedStorefrontOrigin("https://muditam.myshopify.com", "production")).toBe("https://muditam.myshopify.com");
      expect(allowedStorefrontOrigin("https://admin.shopify.com", "production")).toBe("https://admin.shopify.com");
      expect(allowedStorefrontOrigin("https://evil.example", "production")).toBeNull();
      expect(allowedStorefrontOrigin(undefined, "production")).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.MUDITAM_COMMERCE_ALLOWED_ORIGINS;
      else process.env.MUDITAM_COMMERCE_ALLOWED_ORIGINS = previous;
    }
  });

  it("limits repeated messages within a window and resets afterward", () => {
    const limiter = new StorefrontRateLimiter(2, 1_000);
    expect(limiter.allow("visitor", 1_000).allowed).toBe(true);
    expect(limiter.allow("visitor", 1_100).allowed).toBe(true);
    expect(limiter.allow("visitor", 1_200)).toEqual({ allowed: false, retryAfterSeconds: 1 });
    expect(limiter.allow("visitor", 2_000).allowed).toBe(true);
  });
});
