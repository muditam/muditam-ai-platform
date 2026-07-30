import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { OpenAIReportExtractor } from "../../src/modules/metabolic-assistant/adapters/extraction/openai-report-extractor.js";

const payload = {
  document: {
    isBloodReport: true,
    pageCount: 2,
    reportTitle: "Blood Chemistry",
  },
  patient: {
    name: "Test Patient",
    age: 42,
    dateOfBirth: null,
    sex: "female" as const,
  },
  laboratory: {
    name: "Test Lab",
    reportIdentifier: "LAB-1",
    specimenType: "Serum",
    fastingStatus: "FASTING" as const,
    collectedAt: "2026-07-29",
    reportedAt: "2026-07-30",
  },
  biomarkers: [
    {
      canonicalCode: "hba1c" as const,
      panel: "GLYCEMIC" as const,
      sourceLabel: "HbA1c",
      numericValue: 6.2,
      textValue: null,
      unit: "%",
      sourceReferenceRange: "4.0 - 5.6",
      referenceLower: 4,
      referenceUpper: 5.6,
      sourceFlag: "H",
      status: "HIGH" as const,
      confidence: 0.98,
      sourcePage: 1,
      evidenceText: "HbA1c 6.2 % H",
    },
  ],
  warnings: [],
};

describe("OpenAI report extractor", () => {
  it("converts structured OpenAI output into trusted canonical JSON", async () => {
    const parse = vi.fn().mockResolvedValue({
      id: "resp_test",
      output_parsed: payload,
    });
    const extractor = new OpenAIReportExtractor({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      store: false,
      timeoutMs: 1_000,
      client: { responses: { parse } } as unknown as OpenAI,
      now: () => new Date("2026-07-30T00:00:00.000Z"),
    });

    const result = await extractor.extract({
      reportId: "507f1f77bcf86cd799439011",
      fileName: "blood-report.pdf",
      mimeType: "application/pdf",
      sha256: "a".repeat(64),
      bytes: new TextEncoder().encode("%PDF-1.7 synthetic"),
    });

    expect(result.provider).toMatchObject({
      kind: "openai",
      model: "gpt-4o-mini",
      responseId: "resp_test",
      promptVersion: "1.0.0",
    });
    expect(result.source.pageCount).toBe(2);
    expect(result.biomarkers[0]).toMatchObject({
      canonicalCode: "hba1c",
      numericValue: 6.2,
      unit: "%",
      reviewState: "UNREVIEWED",
    });

    const request = parse.mock.calls[0]?.[0] as {
      store: boolean;
      input: Array<{ role: string; content: unknown }>;
    };
    expect(request.store).toBe(false);
    expect(JSON.stringify(request.input)).toContain('"type":"input_file"');
    expect(JSON.stringify(request.input)).toContain(
      '"file_data":"data:application/pdf;base64,',
    );
  });

  it("sends JPEG data as an image and flags uncertain markers for review", async () => {
    const parse = vi.fn().mockResolvedValue({
      id: "resp_image",
      output_parsed: {
        ...payload,
        document: { ...payload.document, pageCount: null },
        biomarkers: [
          {
            ...payload.biomarkers[0],
            canonicalCode: "other",
            confidence: 0.7,
            status: "UNKNOWN",
          },
        ],
      },
    });
    const extractor = new OpenAIReportExtractor({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      store: false,
      timeoutMs: 1_000,
      client: { responses: { parse } } as unknown as OpenAI,
    });

    const result = await extractor.extract({
      reportId: "507f1f77bcf86cd799439011",
      fileName: "blood-report.jpg",
      mimeType: "image/jpeg",
      sha256: "b".repeat(64),
      bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0x00]),
    });

    expect(result.source.pageCount).toBe(1);
    expect(result.biomarkers[0]?.reviewState).toBe("NEEDS_REVIEW");
    expect(JSON.stringify(parse.mock.calls[0]?.[0])).toContain(
      '"type":"input_image"',
    );
  });
});
