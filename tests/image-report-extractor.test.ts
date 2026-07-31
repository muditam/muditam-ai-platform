import { describe, expect, it } from "vitest";
import {
  ExtractionError,
  extractImageReport,
  normalizeReport,
  type ImageObservationExtractor,
} from "../src/index.js";

const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);

function extractorWith(
  observations: Awaited<
    ReturnType<ImageObservationExtractor["extract"]>
  >["observations"],
  options: { isBloodReport?: boolean; quality?: "GOOD" | "UNREADABLE" } = {},
): ImageObservationExtractor {
  return {
    async extract() {
      return {
        document: {
          isBloodReport: options.isBloodReport ?? true,
          quality: options.quality ?? "GOOD",
        },
        observations,
        warnings: [],
      };
    },
  };
}

describe("image report extraction", () => {
  it("converts raw vision facts into the shared canonical pipeline", async () => {
    const structured = await extractImageReport(
      {
        bytes: pngBytes,
        fileName: "report.png",
        mimeType: "image/png",
      },
      extractorWith([
        {
          rawName: "Hba1c (Glycosylated Hemoglobin)",
          rawValue: "7.0",
          unit: "%",
          referenceRange: "4.0 - 5.6",
          rawFlag: "H",
          method: null,
          confidence: 0.96,
          evidenceText: "Hba1c 7.0 %",
        },
      ]),
    );
    const normalized = normalizeReport(structured);

    expect(normalized.observations[0]).toMatchObject({
      biomarker: { canonicalCode: "HBA1C" },
      normalized: {
        value: { type: "NUMERIC", numeric: 7 },
        unit: "%",
      },
      raw: { flag: "H" },
      source: {
        extractionMethod: "OPENAI_VISION",
        extractionConfidence: 0.96,
      },
      confidence: { valueParsing: 0.96, overall: 0.96 },
      decision: "AUTO_ACCEPT",
    });
  });

  it("requires review for a very low-confidence vision value", async () => {
    const structured = await extractImageReport(
      {
        bytes: pngBytes,
        fileName: "blurry.png",
        mimeType: "image/png",
      },
      extractorWith([
        {
          rawName: "HbA1c",
          rawValue: "7.0",
          unit: "%",
          referenceRange: null,
          rawFlag: null,
          method: null,
          confidence: 0.5,
          evidenceText: null,
        },
      ]),
    );

    expect(normalizeReport(structured).observations[0]).toMatchObject({
      decision: "REVIEW_REQUIRED",
      confidence: { valueParsing: 0.5, overall: 0.5 },
    });
  });

  it("preserves the page number when a PDF page is sent to vision", async () => {
    const structured = await extractImageReport(
      {
        bytes: pngBytes,
        fileName: "report.pdf",
        mimeType: "image/png",
        sourcePageNumber: 3,
      },
      extractorWith([
        {
          rawName: "Random glucose",
          rawValue: "194",
          unit: "mg/dL",
          referenceRange: "70 - 140",
          rawFlag: "H",
          method: null,
          confidence: 0.98,
          evidenceText: "Random glucose 194 mg/dL",
        },
      ]),
    );

    expect(normalizeReport(structured).observations[0]?.source.pageNumber).toBe(
      3,
    );
  });

  it("returns no values when the image is unreadable", async () => {
    const structured = await extractImageReport(
      {
        bytes: pngBytes,
        fileName: "unreadable.png",
        mimeType: "image/png",
      },
      extractorWith(
        [
          {
            rawName: "HbA1c",
            rawValue: "6.8",
            unit: "%",
            referenceRange: null,
            rawFlag: null,
            method: null,
            confidence: 0.2,
            evidenceText: null,
          },
        ],
        { quality: "UNREADABLE" },
      ),
    );
    const normalized = normalizeReport(structured, {
      status: "UNREADABLE",
      totalPages: 1,
      pdfTextPages: [],
      visionPages: [],
      failedPages: [1],
      warnings: ["Couldn't read your report. Please contact our dietitian."],
    });

    expect(normalized.observations).toEqual([]);
    expect(normalized.processing.status).toBe("UNREADABLE");
  });

  it("rejects invalid image signatures before calling the provider", async () => {
    await expect(
      extractImageReport(
        {
          bytes: new TextEncoder().encode("not an image"),
          fileName: "fake.png",
          mimeType: "image/png",
        },
        extractorWith([]),
      ),
    ).rejects.toMatchObject({
      code: "INVALID_IMAGE",
    } satisfies Partial<ExtractionError>);
  });

  it("rejects non-blood-report images", async () => {
    await expect(
      extractImageReport(
        {
          bytes: pngBytes,
          fileName: "photo.png",
          mimeType: "image/png",
        },
        extractorWith([], { isBloodReport: false }),
      ),
    ).rejects.toMatchObject({
      code: "NOT_A_BLOOD_REPORT",
    } satisfies Partial<ExtractionError>);
  });
});
