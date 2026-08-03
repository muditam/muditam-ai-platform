import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ExtractionError } from "../errors/extraction-error.js";

export const internalExtractionRequestSchema = z.object({
  reportId: z.string().min(1).max(100),
  files: z
    .array(
      z.object({
        url: z.string().url(),
        mimeType: z.enum([
          "application/pdf",
          "image/jpeg",
          "image/png",
        ]),
        originalName: z.string().min(1).max(255),
        order: z.number().int().min(0).max(9),
      }),
    )
    .min(1)
    .max(10),
});

export type InternalExtractionRequest = z.infer<
  typeof internalExtractionRequestSchema
>;

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function validServiceSecret(received: string | undefined): boolean {
  const expected = process.env.AI_PLATFORM_SERVICE_SECRET;
  if (!expected || expected.length < 32 || !received) return false;
  return timingSafeEqual(digest(received), digest(expected));
}

export function assertAllowedSignedUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  const localAllowed =
    process.env.NODE_ENV !== "production" &&
    process.env.MUDITAM_INTERNAL_ALLOW_LOCAL_URLS === "true";
  const isWasabi =
    url.protocol === "https:" &&
    (url.hostname === "wasabisys.com" || url.hostname.endsWith(".wasabisys.com"));
  const isLocal =
    localAllowed &&
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(url.hostname);
  if (!isWasabi && !isLocal) {
    throw new ExtractionError(
      "INVALID_CONFIGURATION",
      "The signed report URL uses an unapproved storage host.",
    );
  }
  return url;
}
