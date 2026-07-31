import type {
  CanonicalBiomarker,
  CanonicalExtractionResult,
  MetabolicBiomarkerCode,
} from "../contracts/extraction.js";
import {
  BASIC_NORMALIZATION_VERSION,
  normalizedReportSchema,
  type NormalizedBiomarker,
  type NormalizedReport,
} from "../contracts/normalized-report.js";

const displayLabels: Readonly<Record<MetabolicBiomarkerCode, string>> = {
  hba1c: "HbA1c",
  glucose_fasting: "Fasting glucose",
  glucose_post_prandial: "Post-meal glucose",
  glucose_random: "Random glucose",
  insulin_fasting: "Fasting insulin",
  homa_ir: "HOMA-IR",
  cholesterol_total: "Total cholesterol",
  ldl_cholesterol: "LDL cholesterol",
  hdl_cholesterol: "HDL cholesterol",
  triglycerides: "Triglycerides",
  vldl_cholesterol: "VLDL cholesterol",
  non_hdl_cholesterol: "Non-HDL cholesterol",
  apolipoprotein_b: "Apolipoprotein B",
  apolipoprotein_a1: "Apolipoprotein A1",
  vitamin_d_25_oh: "Vitamin D (25-OH)",
  vitamin_b12: "Vitamin B12",
  tsh: "TSH",
  free_t3: "Free T3",
  free_t4: "Free T4",
  creatinine: "Creatinine",
  egfr: "eGFR",
  alt: "ALT",
  ast: "AST",
  ggt: "GGT",
  uric_acid: "Uric acid",
  hs_crp: "hs-CRP",
  hemoglobin: "Hemoglobin",
  ferritin: "Ferritin",
  other: "Other test",
};

const canonicalUnits: Readonly<Record<string, string>> = {
  "%": "%",
  "mg/dl": "mg/dL",
  "mg / dl": "mg/dL",
  "mmol/l": "mmol/L",
  "mmol / l": "mmol/L",
  "µiu/ml": "µIU/mL",
  "uiu/ml": "µIU/mL",
  "miu/l": "mIU/L",
  "ng/ml": "ng/mL",
  "pg/ml": "pg/mL",
  "g/dl": "g/dL",
  "mg/l": "mg/L",
  "ml/min/1.73m2": "mL/min/1.73m²",
};

function normalizeUnit(unit: string | undefined): {
  normalized?: string;
  notes: string[];
} {
  if (unit === undefined) return { notes: ["No unit was extracted."] };
  const compact = unit.trim().replace(/\s+/g, " ");
  const normalized = canonicalUnits[compact.toLowerCase()] ?? compact;
  return {
    normalized,
    notes:
      normalized === compact
        ? []
        : [`Unit text was standardized from "${compact}" to "${normalized}".`],
  };
}

function normalizeBiomarker(
  marker: CanonicalBiomarker,
  minimumConfidence: number,
): NormalizedBiomarker {
  const unit = normalizeUnit(marker.unit);
  const normalizationNotes = [...unit.notes];
  if (marker.canonicalCode === "other") {
    normalizationNotes.push("This test has no supported canonical code yet.");
  }
  if (marker.confidence < minimumConfidence) {
    normalizationNotes.push("Extraction confidence is below the configured limit.");
  }
  if (marker.reviewState === "NEEDS_REVIEW") {
    normalizationNotes.push("This value should be checked against the report.");
  }

  const result: NormalizedBiomarker = {
    id: marker.id,
    canonicalCode: marker.canonicalCode,
    panel: marker.panel,
    sourceLabel: marker.sourceLabel,
    displayLabel:
      marker.canonicalCode === "other"
        ? marker.sourceLabel
        : displayLabels[marker.canonicalCode],
    value: marker.numericValue ?? marker.textValue ?? "Unknown",
    status: marker.status,
    confidence: marker.confidence,
    reviewState: marker.reviewState,
    usableForRules:
      marker.numericValue !== undefined &&
      marker.canonicalCode !== "other" &&
      marker.confidence >= minimumConfidence &&
      marker.reviewState === "CONFIRMED" &&
      unit.normalized !== undefined,
    normalizationNotes,
  };
  if (marker.numericValue !== undefined) {
    result.normalizedNumericValue = marker.numericValue;
  }
  if (marker.unit !== undefined) result.sourceUnit = marker.unit;
  if (unit.normalized !== undefined) result.normalizedUnit = unit.normalized;
  if (marker.sourceReferenceRange !== undefined) {
    result.sourceReferenceRange = marker.sourceReferenceRange;
  }
  if (marker.sourcePage !== undefined) result.sourcePage = marker.sourcePage;
  return result;
}

export function normalizeExtractedReport(
  extraction: CanonicalExtractionResult,
  options: { minimumConfidence: number },
): NormalizedReport {
  const normalized: NormalizedReport = {
    normalizationVersion: BASIC_NORMALIZATION_VERSION,
    extractionSchemaVersion: extraction.schemaVersion,
    reportId: extraction.reportId,
    reportReviewPending: extraction.biomarkers.some(
      (marker) => marker.reviewState !== "CONFIRMED",
    ),
    biomarkers: extraction.biomarkers.map((marker) =>
      normalizeBiomarker(marker, options.minimumConfidence),
    ),
    extractionWarnings: extraction.warnings,
  };
  if (extraction.laboratory?.fastingStatus !== undefined) {
    normalized.fastingStatus = extraction.laboratory.fastingStatus;
  }
  if (extraction.laboratory?.collectedAt !== undefined) {
    normalized.collectedAt = extraction.laboratory.collectedAt;
  }
  return normalizedReportSchema.parse(normalized);
}
