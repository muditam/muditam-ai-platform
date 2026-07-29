import { describe, expect, it } from "vitest";
import {
  findBiomarker,
  normalizeReport,
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
    });
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
});
