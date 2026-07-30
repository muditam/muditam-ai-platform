import { describe, expect, it } from "vitest";
import {
  CANONICAL_EXTRACTION_SCHEMA_VERSION,
  canonicalExtractionResultSchema,
} from "../../src/modules/metabolic-assistant/contracts/extraction.js";

const sha256 = "a".repeat(64);

function providerResult(kind: "openai" | "ocr") {
  return {
    schemaVersion: CANONICAL_EXTRACTION_SCHEMA_VERSION,
    reportId: "report-1",
    provider: {
      kind,
      name: kind === "openai" ? "openai-adapter" : "ocr-adapter",
      version: "1.0.0",
    },
    source: {
      fileName: "report.pdf",
      mimeType: "application/pdf",
      sha256,
      pageCount: 1,
    },
    biomarkers: [
      {
        id: "marker-1",
        canonicalCode: "hba1c",
        panel: "GLYCEMIC",
        sourceLabel: "HbA1c",
        numericValue: 6.2,
        unit: "%",
        sourceReferenceRange: "4.0 - 5.6",
        referenceLower: 4,
        referenceUpper: 5.6,
        status: "HIGH",
        confidence: 0.98,
        sourcePage: 1,
        reviewState: "UNREVIEWED",
      },
    ],
    warnings: [],
    extractedAt: "2026-07-30T00:00:00.000Z",
  };
}

describe("canonical extraction contract", () => {
  it("accepts equivalent OpenAI and OCR results", () => {
    const openai = canonicalExtractionResultSchema.parse(
      providerResult("openai"),
    );
    const ocr = canonicalExtractionResultSchema.parse(providerResult("ocr"));

    expect(openai.biomarkers).toEqual(ocr.biomarkers);
    expect(openai.provider.kind).toBe("openai");
    expect(ocr.provider.kind).toBe("ocr");
  });

  it("rejects biomarkers without a value", () => {
    const invalid = providerResult("ocr");
    delete (invalid.biomarkers[0] as { numericValue?: number }).numericValue;
    expect(canonicalExtractionResultSchema.safeParse(invalid).success).toBe(
      false,
    );
  });
});
