import {
  BIOMARKER_CATALOGUE_VERSION,
} from "../catalogue/biomarkers.js";
import { resolveBiomarker } from "../catalogue/biomarker-resolver.js";
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
    .replace(/\s+/g, "")
    .replace(/^gm\//, "g/")
    .replace(/mm\/1sthour/g, "mm/hr");
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
  sourcePanel: string,
  layout: StructuredReport["layoutAnalysis"],
): NormalizedObservation {
  const resolution = resolveBiomarker({
    rawName: observation.raw.name,
    panel: sourcePanel,
    ...(observation.raw.unit ? { unit: observation.raw.unit } : {}),
  });
  const definition = resolution.definition;
  const extractedUnit = normalizeUnit(observation.raw.unit);
  const unit =
    definition?.standardUnit &&
    extractedUnit &&
    comparableUnit(definition.standardUnit) === comparableUnit(extractedUnit)
      ? definition.standardUnit
      : extractedUnit;
  const referenceRange = normalizeReferenceRange(
    observation.raw.referenceRange,
  );
  const issues: NormalizedObservation["validation"]["issues"] = [];

  if (resolution.status !== "MAPPED") {
    issues.push({
      code: "UNMAPPED_BIOMARKER",
      message:
        resolution.status === "UNMAPPED"
          ? `No canonical mapping for "${observation.raw.name}".`
          : `Canonical mapping requires confirmation for "${observation.raw.name}".`,
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

  const hasUnitMismatch = issues.some(
    (issue) => issue.code === "UNIT_MISMATCH",
  );
  const mappingConfidence = resolution.confidence;
  const layoutConfidence = layout.confidence;
  const valueParsingConfidence =
    observation.source.extractionConfidence ?? 1;
  const unitCompatibilityConfidence = hasUnitMismatch
    ? 0
    : definition?.standardUnit && !unit
      ? 0.7
      : 1;
  const overallConfidence = Number(
    Math.min(
      mappingConfidence,
      layoutConfidence,
      valueParsingConfidence,
      unitCompatibilityConfidence,
    ).toFixed(3),
  );
  const decision =
    resolution.status === "UNMAPPED" ||
    resolution.status === "AMBIGUOUS" ||
    hasUnitMismatch ||
    valueParsingConfidence < 0.6
      ? "REVIEW_REQUIRED"
      : resolution.status === "POSSIBLE_MATCH" ||
          resolution.confidence < 0.95 ||
          layout.strategy === "FALLBACK" ||
          layout.confidence < 0.8 ||
          valueParsingConfidence < 0.85 ||
          issues.length > 0
        ? "USER_CONFIRMATION"
        : "AUTO_ACCEPT";

  return {
    sourceObservationId: observation.id,
    biomarker: definition
      ? {
          canonicalCode: definition.canonicalCode,
          canonicalName: definition.canonicalName,
          panel: definition.panel,
        }
      : null,
    mapping: {
      status: resolution.status,
      method: resolution.method,
      ...(resolution.method === "EXACT_ALIAS"
        ? { matchedAlias: observation.raw.name }
        : {}),
      ...(resolution.suggestedCanonicalCode
        ? { suggestedCanonicalCode: resolution.suggestedCanonicalCode }
        : {}),
      confidence: resolution.confidence,
      evidence: resolution.evidence,
      alternatives: resolution.alternatives,
    },
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
    confidence: {
      mapping: mappingConfidence,
      layout: layoutConfidence,
      valueParsing: valueParsingConfidence,
      unitCompatibility: unitCompatibilityConfidence,
      overall: overallConfidence,
    },
    decision,
    source: observation.source,
  };
}

function normalizedValueKey(
  observation: NormalizedObservation,
): string {
  return JSON.stringify({
    value: observation.normalized.value,
    unit: observation.normalized.unit,
  });
}

function markDuplicateConflicts(
  observations: NormalizedObservation[],
): void {
  const byCode = new Map<string, NormalizedObservation[]>();
  for (const observation of observations) {
    const code = observation.biomarker?.canonicalCode;
    if (!code) continue;
    const group = byCode.get(code) ?? [];
    group.push(observation);
    byCode.set(code, group);
  }
  for (const [code, group] of byCode) {
    const distinctValues = new Set(group.map(normalizedValueKey));
    if (group.length < 2 || distinctValues.size < 2) continue;
    for (const observation of group) {
      observation.validation.issues.push({
        code: "DUPLICATE_CONFLICT",
        message: `Conflicting values were extracted for ${code}.`,
      });
      observation.validation.status = "REVIEW_REQUIRED";
      observation.decision = "REVIEW_REQUIRED";
      observation.confidence.overall = Math.min(
        observation.confidence.overall,
        0.5,
      );
    }
  }
}

export function normalizeReport(
  report: StructuredReport,
  processing: NormalizedReport["processing"] = {
    status: "COMPLETE",
    totalPages: 1,
    pdfTextPages: [1],
    visionPages: [],
    failedPages: [],
    warnings: [],
  },
): NormalizedReport {
  const observations = report.panels.flatMap((panel) =>
    panel.observations.map((observation) =>
      normalizeObservation(observation, panel.name, report.layoutAnalysis),
    ),
  );
  markDuplicateConflicts(observations);
  const mappedCount = observations.filter(
    (observation) => observation.mapping.status === "MAPPED",
  ).length;
  const possibleMatchCount = observations.filter(
    (observation) => observation.mapping.status === "POSSIBLE_MATCH",
  ).length;
  const ambiguousCount = observations.filter(
    (observation) => observation.mapping.status === "AMBIGUOUS",
  ).length;
  const unmappedCount = observations.filter(
    (observation) => observation.mapping.status === "UNMAPPED",
  ).length;
  const autoAcceptedCount = observations.filter(
    (observation) => observation.decision === "AUTO_ACCEPT",
  ).length;
  const userConfirmationCount = observations.filter(
    (observation) => observation.decision === "USER_CONFIRMATION",
  ).length;
  const reviewRequiredCount = observations.filter(
    (observation) => observation.decision === "REVIEW_REQUIRED",
  ).length;
  const result: NormalizedReport = {
    schemaVersion: NORMALIZED_REPORT_SCHEMA_VERSION,
    documentId: report.documentId,
    sourceStructuredSchemaVersion: report.schemaVersion,
    catalogueVersion: BIOMARKER_CATALOGUE_VERSION,
    sourceLayoutAnalysis: report.layoutAnalysis,
    status: reviewRequiredCount > 0 ? "REVIEW_REQUIRED" : "NORMALIZED",
    processing,
    observations,
    unclassifiedContent: report.unclassifiedContent,
    statistics: {
      observationCount: observations.length,
      mappedCount,
      possibleMatchCount,
      ambiguousCount,
      unmappedCount,
      reviewRequiredCount,
      autoAcceptedCount,
      userConfirmationCount,
    },
  };
  return normalizedReportSchema.parse(result);
}
