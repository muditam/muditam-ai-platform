import { afterEach, describe, expect, it } from "vitest";
import {
  assertAllowedSignedUrl,
  internalExtractionRequestSchema,
  validServiceSecret,
} from "../src/internal/extraction-request.js";

afterEach(() => {
  delete process.env.AI_PLATFORM_SERVICE_SECRET;
  delete process.env.MUDITAM_INTERNAL_ALLOW_LOCAL_URLS;
});

describe("internal extraction security", () => {
  it("accepts only the configured service secret", () => {
    process.env.AI_PLATFORM_SERVICE_SECRET = "a".repeat(64);
    expect(validServiceSecret("a".repeat(64))).toBe(true);
    expect(validServiceSecret("b".repeat(64))).toBe(false);
    expect(validServiceSecret(undefined)).toBe(false);
  });

  it("allows signed Wasabi hosts and rejects arbitrary SSRF targets", () => {
    expect(() => assertAllowedSignedUrl("https://bucket.s3.ap-southeast-2.wasabisys.com/report.pdf?signature=1")).not.toThrow();
    expect(() => assertAllowedSignedUrl("http://169.254.169.254/latest/meta-data")).toThrow();
    expect(() => assertAllowedSignedUrl("https://example.com/report.pdf")).toThrow();
  });

  it("rejects mixed or oversized internal request structures", () => {
    const parsed = internalExtractionRequestSchema.safeParse({
      reportId: "report-1",
      files: [{
        url: "https://bucket.s3.ap-southeast-2.wasabisys.com/report.pdf",
        mimeType: "application/pdf",
        originalName: "report.pdf",
        order: 0,
      }],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects DOCX until a real DOCX extraction path exists", () => {
    const parsed = internalExtractionRequestSchema.safeParse({
      reportId: "report-1",
      files: [{
        url: "https://bucket.s3.ap-southeast-2.wasabisys.com/report.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        originalName: "report.docx",
        order: 0,
      }],
    });
    expect(parsed.success).toBe(false);
  });
});
