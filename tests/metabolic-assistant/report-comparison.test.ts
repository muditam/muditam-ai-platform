import { describe, expect, it } from "vitest";
import type { NormalizedReportContext } from "../../src/modules/metabolic-assistant/contracts/report-comparison.js";
import { normalizeExtractedReport } from "../../src/modules/metabolic-assistant/normalization/basic-report-normalizer.js";
import { compareNormalizedReports } from "../../src/modules/metabolic-assistant/normalization/compare-normalized-reports.js";

function context(
  reportId: string,
  displayName: string,
  uploadedAt: string,
  value: number,
  unit = "%",
): NormalizedReportContext {
  return {
    reportId,
    displayName,
    uploadedAt,
    normalized: normalizeExtractedReport(
      {
        schemaVersion: "1.0.0",
        reportId,
        provider: { kind: "test", name: "fixture", version: "1" },
        source: {
          fileName: displayName,
          mimeType: "application/pdf",
          sha256: "a".repeat(64),
        },
        biomarkers: [
          {
            id: "hba1c-1",
            canonicalCode: "hba1c",
            panel: "GLYCEMIC",
            sourceLabel: "HbA1c",
            numericValue: value,
            unit,
            status: "UNKNOWN",
            confidence: 0.99,
            sourcePage: 2,
            reviewState: "UNREVIEWED",
          },
        ],
        warnings: [],
        extractedAt: uploadedAt,
      },
      { minimumConfidence: 0.6 },
    ),
  };
}

describe("normalized report comparison", () => {
  it("calculates a trusted latest change using upload order", () => {
    const comparison = compareNormalizedReports([
      context(
        "507f1f77bcf86cd799439011",
        "January.pdf",
        "2026-01-01T00:00:00.000Z",
        7.2,
      ),
      context(
        "507f1f77bcf86cd799439012",
        "July.pdf",
        "2026-07-01T00:00:00.000Z",
        6.4,
      ),
    ]);

    expect(comparison.biomarkers[0]).toMatchObject({
      canonicalCode: "hba1c",
      unit: "%",
      latestChange: {
        absolute: -0.8,
        direction: "DECREASED",
      },
    });
    expect(comparison.biomarkers[0]?.latestChange.percent).toBeCloseTo(
      -11.111,
      2,
    );
  });

  it("does not compare values when their normalized units differ", () => {
    const comparison = compareNormalizedReports([
      context(
        "507f1f77bcf86cd799439011",
        "A.pdf",
        "2026-01-01T00:00:00.000Z",
        6.4,
        "%",
      ),
      context(
        "507f1f77bcf86cd799439012",
        "B.pdf",
        "2026-02-01T00:00:00.000Z",
        46,
        "mmol/L",
      ),
    ]);

    expect(comparison.biomarkers).toEqual([]);
    expect(comparison.warnings[0]).toContain("different units");
  });
});
