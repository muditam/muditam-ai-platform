import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const sessionPayloadSchema = z.object({
  version: z.literal(1),
  conversationId: z.string().uuid(),
  visitorId: z.string().uuid(),
  issuedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
});

export type StorefrontSession = z.infer<typeof sessionPayloadSchema>;

export interface CreatedStorefrontSession extends StorefrontSession {
  token: string;
}

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

function configuredSecret(): string {
  const secret = process.env.MUDITAM_COMMERCE_SESSION_SECRET ?? "";
  if (secret.length < 32) throw new Error("MUDITAM_COMMERCE_SESSION_SECRET must contain at least 32 characters");
  return secret;
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createStorefrontSession(options: {
  secret?: string;
  now?: number;
  ttlSeconds?: number;
} = {}): CreatedStorefrontSession {
  const secret = options.secret ?? configuredSecret();
  if (secret.length < 32) throw new Error("Storefront session secret must contain at least 32 characters");
  const issuedAt = options.now ?? Math.floor(Date.now() / 1000);
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 7 * 24 * 60 * 60) {
    throw new Error("Storefront session TTL must be between 60 seconds and 7 days");
  }
  const session: StorefrontSession = {
    version: 1,
    conversationId: randomUUID(),
    visitorId: randomUUID(),
    issuedAt,
    expiresAt: issuedAt + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(session)).toString("base64url");
  return { ...session, token: `${encoded}.${signature(encoded, secret)}` };
}

export function verifyStorefrontSession(
  token: string,
  options: { secret?: string; now?: number } = {},
): StorefrontSession | null {
  const secret = options.secret ?? configuredSecret();
  const [encoded, providedSignature, extra] = token.split(".");
  if (!encoded || !providedSignature || extra) return null;
  const expected = signature(encoded, secret);
  const providedBytes = Buffer.from(providedSignature);
  const expectedBytes = Buffer.from(expected);
  if (providedBytes.length !== expectedBytes.length || !timingSafeEqual(providedBytes, expectedBytes)) return null;
  try {
    const parsed = sessionPayloadSchema.safeParse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
    if (!parsed.success) return null;
    const now = options.now ?? Math.floor(Date.now() / 1000);
    if (parsed.data.expiresAt <= now || parsed.data.issuedAt > now + 60) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function bearerToken(header: string | string[] | undefined): string | null {
  if (typeof header !== "string") return null;
  const match = header.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] ?? null;
}
