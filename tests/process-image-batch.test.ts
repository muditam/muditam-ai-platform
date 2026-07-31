import { describe, expect, it } from "vitest";
import {
  normalizeReport,
  processImageBatch,
  type ImageObservationExtractor,
} from "../src/index.js";

const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);

const pages = [1, 2, 3].map((pageNumber) => ({
  bytes: pngBytes,
  fileName: `page-${pageNumber}.png`,
  mimeType: "image/png" as const,
}));

describe("processImageBatch", () => {
  it("merges successful photos and preserves their ordered page numbers", async () => {
    const extractor: ImageObservationExtractor = {
      async extract(input) {
        const pageNumber = input.sourcePageNumber ?? 1;
        if (pageNumber === 2) {
          return {
            document: { isBloodReport: true, quality: "UNREADABLE" },
            observations: [],
            warnings: ["Page is blurred."],
          };
        }
        return {
          document: { isBloodReport: true, quality: "GOOD" },
          observations: [
            {
              rawName: pageNumber === 1 ? "Glucose (Fasting)" : "Creatinine",
              rawValue: pageNumber === 1 ? "265" : "0.8",
              unit: "mg/dL",
              referenceRange: null,
              rawFlag: null,
              method: null,
              confidence: 0.97,
              evidenceText: null,
            },
          ],
          warnings: [],
        };
      },
    };

    const result = await processImageBatch(pages, extractor);
    const normalized = normalizeReport(result.structured, {
      status: "PARTIAL",
      totalPages: 3,
      pdfTextPages: [],
      visionPages: result.successfulPages,
      failedPages: result.failedPages,
      warnings: ["Some pages could not be read."],
    });

    expect(result.successfulPages).toEqual([1, 3]);
    expect(result.failedPages).toEqual([2]);
    expect(
      normalized.observations.map((observation) => ({
        code: observation.biomarker?.canonicalCode,
        page: observation.source.pageNumber,
      })),
    ).toEqual([
      { code: "FASTING_GLUCOSE", page: 1 },
      { code: "CREATININE", page: 3 },
    ]);
  });

  it("returns an empty structured result when every photo is unreadable", async () => {
    const extractor: ImageObservationExtractor = {
      async extract() {
        return {
          document: { isBloodReport: true, quality: "UNREADABLE" },
          observations: [],
          warnings: [],
        };
      },
    };

    const result = await processImageBatch(pages.slice(0, 2), extractor);

    expect(result.structured.statistics.observationCount).toBe(0);
    expect(result.successfulPages).toEqual([]);
    expect(result.failedPages).toEqual([1, 2]);
  });
});
