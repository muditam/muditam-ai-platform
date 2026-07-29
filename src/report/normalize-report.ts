import {
  BIOMARKER_CATALOGUE_VERSION,
  findBiomarker,
} from "../catalogue/biomarkers.js";
import {
  NORMALIZED_REPORT_SCHEMA_VERSION,
  normalizedReportSchema,
  type NormalizedObservation,
  type NormalizedReport,
} from "../contracts/normalized-report.js";
import type {
  Observation,
  StructuredReport,
} from "../contracts/structured-report.js";

function normalizeUnit(unit: string | undefined): string | null {
  if (!unit || /^[-–—]$/.test(unit.trim())) return null;
  return unit
    .trim()
    .replace(/μ/g, "µ")
    .replace(/\bfl\b/i, "fL")
    .replace(/\bml\b/g, "mL")
    .replace(/\bsq m\b/i, "m²")
    .replace(/\s+/g, " ");
}

function comparableUnit(unit: string): string {
  const comparable = unit
    .toLowerCase()
    .replace(/[µμ]/g, "u")
    .replace(/\^/g, "")
    .replace(/²/g, "2")
    .replace(/\s+/g, "");
  if (comparable === "miu/l" || comparable === "uiu/ml") return "uiu/ml";
  return comparable;
}

function normalizedValue(
  value: Observation["parsedValue"],
): NormalizedObservation["normalized"]["value"] {
  switch (value.type) {
    case "NUMERIC":
      return { type: "NUMERIC", numeric: value.numericValue };
    case "INEQUALITY":
      return {
        type: "INEQUALITY",
        comparator: value.comparator,
        numeric: value.numericValue,
      };
    case "RANGE":
      return { type: "RANGE", lower: value.lower, upper: value.upper };
    case "QUALITATIVE":
      return { type: "QUALITATIVE", text: value.text };
  }
}

function parseNumber(text: string): number | undefined {
  const normalized = text.replace(/,/g, "").trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return undefined;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

function normalizeReferenceRange(
  raw: string | undefined,
): NormalizedObservation["normalized"]["referenceRange"] {
  if (!raw) return null;
  const bound = raw.trim().match(/^(<=|>=|<|>)\s*(-?\d+(?:\.\d+)?)$/);
  if (bound) {
    return {
      type: "BOUND",
      comparator: bound[1] as "<" | "<=" | ">" | ">=",
      value: Number(bound[2]),
    };
  }
  const categoricalBound = raw
    .trim()
    .match(/^(.+?)\s*:?\s*(<=|>=|<|>)\s*(-?\d+(?:\.\d+)?)$/);
  if (categoricalBound) {
    return {
      type: "CATEGORICAL_BOUND",
      label: (categoricalBound[1] ?? "").replace(/\s*:\s*$/, "").trim(),
      comparator: categoricalBound[2] as "<" | "<=" | ">" | ">=",
      value: Number(categoricalBound[3]),
    };
  }
  const interval = raw
    .trim()
    .match(
      /^(-?\d+(?:\.\d+)?)\s*(?:[-–—]|to)\s*(-?\d+(?:\.\d+)?)(?:\s+[^\d]+)?$/i,
    );
  if (interval) {
    return {
      type: "INTERVAL",
      lower: Number(interval[1]),
      upper: Number(interval[2]),
    };
  }
  const upTo = raw
    .trim()
    .match(/^up\s+to\s+(-?\d+(?:\.\d+)?)(?:\s+[^\d]+)?$/i);
  if (upTo) {
    return {
      type: "BOUND",
      comparator: "<=",
      value: Number(upTo[1]),
    };
  }
  return { type: "TEXT", text: raw.trim() };
}

function normalizeObservation(
  observation: Observation,
): NormalizedObservation {
  const definition = findBiomarker(observation.raw.name);
  const unit = normalizeUnit(observation.raw.unit);
  const referenceRange = normalizeReferenceRange(
    observation.raw.referenceRange,
  );
  const issues: NormalizedObservation["validation"]["issues"] = [];

  if (!definition) {
    issues.push({
      code: "UNMAPPED_BIOMARKER",
      message: `No canonical mapping for "${observation.raw.name}".`,
    });
  }
  if (
    definition?.standardUnit &&
    unit &&
    comparableUnit(definition.standardUnit) !== comparableUnit(unit)
  ) {
    issues.push({
      code: "UNIT_MISMATCH",
      message: `Expected ${definition.standardUnit}, received ${unit}.`,
    });
  }
  if (referenceRange?.type === "TEXT") {
    const containsNumber = /\d/.test(referenceRange.text);
    if (containsNumber && parseNumber(referenceRange.text) === undefined) {
      issues.push({
        code: "UNPARSED_REFERENCE_RANGE",
        message: `Reference range requires structured parsing: "${referenceRange.text}".`,
      });
    }
  }

  return {
    sourceObservationId: observation.id,
    biomarker: definition
      ? {
          canonicalCode: definition.canonicalCode,
          canonicalName: definition.canonicalName,
          panel: definition.panel,
        }
      : null,
    mapping: definition
      ? {
          status: "MAPPED",
          matchedAlias: observation.raw.name,
          confidence: 1,
        }
      : { status: "UNMAPPED", confidence: 0 },
    raw: observation.raw,
    normalized: {
      value: normalizedValue(observation.parsedValue),
      unit,
      referenceRange,
    },
    validation: {
      status: issues.length === 0 ? "VALID" : "REVIEW_REQUIRED",
      issues,
    },
    source: observation.source,
  };
}

export function normalizeReport(
  report: StructuredReport,
): NormalizedReport {
  const observations = report.panels.flatMap((panel) =>
    panel.observations.map(normalizeObservation),
  );
  const mappedCount = observations.filter(
    (observation) => observation.mapping.status === "MAPPED",
  ).length;
  const reviewRequiredCount = observations.filter(
    (observation) => observation.validation.status === "REVIEW_REQUIRED",
  ).length;
  const result: NormalizedReport = {
    schemaVersion: NORMALIZED_REPORT_SCHEMA_VERSION,
    documentId: report.documentId,
    sourceStructuredSchemaVersion: report.schemaVersion,
    catalogueVersion: BIOMARKER_CATALOGUE_VERSION,
    status: reviewRequiredCount > 0 ? "REVIEW_REQUIRED" : "NORMALIZED",
    observations,
    unclassifiedContent: report.unclassifiedContent,
    statistics: {
      observationCount: observations.length,
      mappedCount,
      unmappedCount: observations.length - mappedCount,
      reviewRequiredCount,
    },
  };
  return normalizedReportSchema.parse(result);
}
