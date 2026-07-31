import { describe, expect, it } from "vitest";
import type { CanonicalExtractionResult } from "../../src/modules/metabolic-assistant/contracts/extraction.js";
import { normalizeExtractedReport } from "../../src/modules/metabolic-assistant/normalization/basic-report-normalizer.js";

const extraction: CanonicalExtractionResult = {
  schemaVersion: "1.0.0",
  reportId: "507f1f77bcf86cd799439011",
  provider: {
    kind: "test",
    name: "fixture",
    version: "1",
  },
  source: {
    fileName: "report.pdf",
    mimeType: "application/pdf",
    sha256: "a".repeat(64),
  },
  biomarkers: [
    {
      id: "glucose_fasting-1",
      canonicalCode: "glucose_fasting",
      panel: "GLYCEMIC",
      sourceLabel: "Fasting Blood Sugar",
      numericValue: 118,
      unit: "mg/dl",
      status: "HIGH",
      confidence: 0.94,
      sourcePage: 2,
      reviewState: "CONFIRMED",
    },
  ],
  warnings: [],
  extractedAt: "2026-07-31T00:00:00.000Z",
};

describe("basic report normalization", () => {
  it("standardizes safe labels and unit spelling without changing the value", () => {
    const normalized = normalizeExtractedReport(extraction, {
      minimumConfidence: 0.6,
    });
    const marker = normalized.biomarkers[0];

    expect(marker).toMatchObject({
      displayLabel: "Fasting glucose",
      value: 118,
      normalizedNumericValue: 118,
      sourceUnit: "mg/dl",
      normalizedUnit: "mg/dL",
      usableForRules: true,
    });
    expect(normalized.reportReviewPending).toBe(false);
  });

  it("marks low-confidence values as unsafe for future rule engines", () => {
    const lowConfidence: CanonicalExtractionResult = {
      ...extraction,
      biomarkers: [
        {
          ...extraction.biomarkers[0]!,
          confidence: 0.4,
        },
      ],
    };
    const normalized = normalizeExtractedReport(lowConfidence, {
      minimumConfidence: 0.6,
    });

    expect(normalized.biomarkers[0]?.usableForRules).toBe(false);
    expect(normalized.biomarkers[0]?.normalizationNotes).toContain(
      "Extraction confidence is below the configured limit.",
    );
  });
});
