import { describe, expect, it } from "vitest";
import {
  findBiomarker,
  normalizeReport,
  verifyGoldenReport,
  type StructuredReport,
} from "../src/index.js";

const source = {
  pageNumber: 1,
  lineId: "p1-l1",
  itemIds: ["p1-i1"],
  boundingBox: { x: 10, y: 10, width: 100, height: 10 },
};

function reportWith(
  observations: StructuredReport["panels"][number]["observations"],
): StructuredReport {
  return {
    schemaVersion: "0.1.0",
    documentId: "doc-test",
    sourceExtractionSchemaVersion: "1.0.0",
    status: "STRUCTURED",
    layoutAnalysis: {
      strategy: "CLUSTERED",
      confidence: 1,
      evidenceRowCount: observations.length,
      anchors: {
        description: 0.05,
        value: 0.48,
        unit: 0.64,
        referenceRange: 0.78,
      },
    },
    panels: [{ name: "Test panel", observations }],
    unclassifiedContent: [],
    statistics: {
      observationCount: observations.length,
      classifiedLineCount: observations.length,
      unclassifiedLineCount: 0,
    },
  };
}

describe("biomarker normalization", () => {
  it("maps aliases to stable canonical identities", () => {
    expect(findBiomarker("SGPT/ALT")?.canonicalCode).toBe("ALT");
    expect(findBiomarker("Glycosylated Haemoglobin")?.canonicalCode).toBe(
      "HBA1C",
    );
    expect(findBiomarker("PCV")?.canonicalCode).toBe("HEMATOCRIT");
    expect(
      findBiomarker("Aspartate Aminotransferase (AST/SGOT)")?.canonicalCode,
    ).toBe("AST");
    expect(findBiomarker("Serum HDL Cholesterol")?.canonicalCode).toBe(
      "HDL_CHOLESTEROL",
    );
  });

  it("normalizes mapped values, units and interval ranges", () => {
    const result = normalizeReport(
      reportWith([
        {
          id: "obs-1",
          raw: {
            name: "Glucose Fasting",
            value: "148",
            unit: "mg/dL",
            referenceRange: "70 - 100",
            flag: "H",
          },
          parsedValue: { type: "NUMERIC", numericValue: 148 },
          source,
        },
      ]),
    );

    expect(result.status).toBe("NORMALIZED");
    expect(result.statistics).toMatchObject({
      observationCount: 1,
      mappedCount: 1,
      unmappedCount: 0,
    });
    expect(result.observations[0]).toMatchObject({
      biomarker: { canonicalCode: "FASTING_GLUCOSE" },
      decision: "AUTO_ACCEPT",
      confidence: {
        mapping: 1,
        layout: 1,
        valueParsing: 1,
        unitCompatibility: 1,
        overall: 1,
      },
      normalized: {
        value: { type: "NUMERIC", numeric: 148 },
        unit: "mg/dL",
        referenceRange: { type: "INTERVAL", lower: 70, upper: 100 },
      },
      validation: { status: "VALID" },
    });
  });

  it("retains unmapped observations and marks them for review", () => {
    const result = normalizeReport(
      reportWith([
        {
          id: "obs-1",
          raw: { name: "Novel Marker XYZ", value: "17.4", unit: "mg/L" },
          parsedValue: { type: "NUMERIC", numericValue: 17.4 },
          source,
        },
      ]),
    );

    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.observations[0]).toMatchObject({
      biomarker: null,
      mapping: { status: "UNMAPPED", confidence: 0 },
      raw: { name: "Novel Marker XYZ", value: "17.4" },
      validation: {
        status: "REVIEW_REQUIRED",
        issues: [{ code: "UNMAPPED_BIOMARKER" }],
      },
      decision: "REVIEW_REQUIRED",
    });
  });

  it("requires review when a mapped biomarker has an incompatible unit", () => {
    const result = normalizeReport(
      reportWith([
        {
          id: "obs-1",
          raw: {
            name: "Glucose Fasting",
            value: "148",
            unit: "g/dL",
          },
          parsedValue: { type: "NUMERIC", numericValue: 148 },
          source,
        },
      ]),
    );

    expect(result.observations[0]).toMatchObject({
      biomarker: { canonicalCode: "FASTING_GLUCOSE" },
      decision: "REVIEW_REQUIRED",
      confidence: { unitCompatibility: 0, overall: 0 },
      validation: {
        status: "REVIEW_REQUIRED",
        issues: [{ code: "UNIT_MISMATCH" }],
      },
    });
  });

  it("requires user confirmation for an otherwise valid fallback layout", () => {
    const report = reportWith([
      {
        id: "obs-1",
        raw: {
          name: "Glucose Fasting",
          value: "148",
          unit: "mg/dL",
        },
        parsedValue: { type: "NUMERIC", numericValue: 148 },
        source,
      },
    ]);
    report.layoutAnalysis.strategy = "FALLBACK";
    report.layoutAnalysis.confidence = 0.65;

    const result = normalizeReport(report);

    expect(result.observations[0]).toMatchObject({
      validation: { status: "VALID" },
      decision: "USER_CONFIRMATION",
      confidence: { layout: 0.65, overall: 0.65 },
    });
    expect(result.statistics).toMatchObject({
      autoAcceptedCount: 0,
      userConfirmationCount: 1,
      reviewRequiredCount: 0,
    });
  });

  it("blocks conflicting values mapped to the same canonical biomarker", () => {
    const result = normalizeReport(
      reportWith([
        {
          id: "obs-1",
          raw: {
            name: "SGPT/ALT",
            value: "19.5",
            unit: "U/L",
          },
          parsedValue: { type: "NUMERIC", numericValue: 19.5 },
          source,
        },
        {
          id: "obs-2",
          raw: {
            name: "Alanine Aminotransferase",
            value: "91",
            unit: "U/L",
          },
          parsedValue: { type: "NUMERIC", numericValue: 91 },
          source: { ...source, lineId: "p1-l2" },
        },
      ]),
    );

    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.observations).toHaveLength(2);
    for (const observation of result.observations) {
      expect(observation).toMatchObject({
        biomarker: { canonicalCode: "ALT" },
        decision: "REVIEW_REQUIRED",
        validation: {
          status: "REVIEW_REQUIRED",
          issues: [{ code: "DUPLICATE_CONFLICT" }],
        },
      });
      expect(observation.confidence.overall).toBeLessThanOrEqual(0.5);
    }
  });

  it("parses labelled clinical reference bounds", () => {
    const result = normalizeReport(
      reportWith([
        {
          id: "obs-1",
          raw: {
            name: "Vitamin D 25 - Hydroxy",
            value: "< 3.5",
            unit: "ng/mL",
            referenceRange: "Deficient <20",
          },
          parsedValue: {
            type: "INEQUALITY",
            comparator: "<",
            numericValue: 3.5,
          },
          source,
        },
      ]),
    );

    expect(result.observations[0]?.normalized.referenceRange).toEqual({
      type: "CATEGORICAL_BOUND",
      label: "Deficient",
      comparator: "<",
      value: 20,
    });
    expect(result.observations[0]?.validation.status).toBe("VALID");
  });

  it("verifies normalized output against explicit golden expectations", () => {
    const result = normalizeReport(
      reportWith([
        {
          id: "obs-1",
          raw: {
            name: "Glucose Fasting",
            value: "78",
            unit: "mg/dL",
            referenceRange: "70 - 100",
          },
          parsedValue: { type: "NUMERIC", numericValue: 78 },
          source,
        },
      ]),
    );
    const verification = verifyGoldenReport(result, {
      name: "synthetic",
      reviewStatus: "VERIFIED",
      expectedReportStatus: "NORMALIZED",
      expectedObservationCount: 1,
      observations: [
        {
          canonicalCode: "FASTING_GLUCOSE",
          numeric: 78,
          unit: "mg/dL",
          flag: null,
        },
      ],
    });

    expect(verification.passed).toBe(true);
    expect(verification.checks[0]?.passed).toBe(true);
  });
});
