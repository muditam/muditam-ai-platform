import { METABOLIC_BIOMARKER_CODES } from "../../contracts/extraction.js";

export const METABOLIC_EXTRACTION_PROMPT_VERSION = "1.0.0" as const;

export function buildBloodReportExtractionPrompt(): string {
  return [
    "You extract facts from human blood-test reports.",
    "Return only information visibly present in the supplied PDF or image.",
    "Do not diagnose, recommend treatment, or infer a missing value.",
    "Preserve the printed label, value, unit, reference range, flag, dates, and page.",
    "Use numericValue only when a numeric result is clearly readable; otherwise use textValue.",
    "Use status only when a printed flag or wording supports it. Otherwise use UNKNOWN.",
    "Use confidence below 0.85 for blurry, partially obscured, or ambiguous values.",
    "Use canonicalCode=other when no listed code is a clear match.",
    `Allowed canonicalCode values: ${METABOLIC_BIOMARKER_CODES.join(", ")}.`,
    "If this is not a blood-test report, set isBloodReport=false and return no biomarkers.",
    "Add a warning for unreadable pages, missing units, ambiguous values, or non-blood-report input.",
    "For an image, sourcePage is 1. For a PDF, sourcePage is the visible 1-based page number.",
  ].join("\n");
}
