import { z } from "zod";

export const CANONICAL_EXTRACTION_SCHEMA_VERSION = "1.0.0" as const;

export const METABOLIC_BIOMARKER_CODES = [
  "hba1c",
  "glucose_fasting",
  "glucose_post_prandial",
  "glucose_random",
  "insulin_fasting",
  "homa_ir",
  "cholesterol_total",
  "ldl_cholesterol",
  "hdl_cholesterol",
  "triglycerides",
  "vldl_cholesterol",
  "non_hdl_cholesterol",
  "apolipoprotein_b",
  "apolipoprotein_a1",
  "vitamin_d_25_oh",
  "vitamin_b12",
  "tsh",
  "free_t3",
  "free_t4",
  "creatinine",
  "egfr",
  "alt",
  "ast",
  "ggt",
  "uric_acid",
  "hs_crp",
  "hemoglobin",
  "ferritin",
  "other",
] as const;

export const metabolicBiomarkerCodeSchema = z.enum(
  METABOLIC_BIOMARKER_CODES,
);

export const biomarkerPanelSchema = z.enum([
  "GLYCEMIC",
  "LIPID",
  "THYROID",
  "LIVER",
  "KIDNEY",
  "VITAMIN_MINERAL",
  "INFLAMMATION",
  "HEMATOLOGY",
  "OTHER",
]);

export const extractionProviderSchema = z.object({
  kind: z.enum(["openai", "ocr", "manual", "test"]),
  name: z.string().trim().min(1),
  version: z.string().trim().min(1),
  model: z.string().trim().min(1).optional(),
  promptVersion: z.string().trim().min(1).optional(),
  responseId: z.string().trim().min(1).optional(),
});

export const canonicalBiomarkerSchema = z.object({
  id: z.string().trim().min(1),
  canonicalCode: metabolicBiomarkerCodeSchema,
  panel: biomarkerPanelSchema,
  sourceLabel: z.string().trim().min(1),
  numericValue: z.number().finite().optional(),
  textValue: z.string().trim().min(1).optional(),
  unit: z.string().trim().min(1).optional(),
  sourceReferenceRange: z.string().trim().min(1).optional(),
  referenceLower: z.number().finite().optional(),
  referenceUpper: z.number().finite().optional(),
  sourceFlag: z.string().trim().min(1).optional(),
  status: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL", "UNKNOWN"]),
  confidence: z.number().min(0).max(1),
  sourcePage: z.number().int().positive().optional(),
  evidenceText: z.string().trim().min(1).optional(),
  reviewState: z.enum(["UNREVIEWED", "NEEDS_REVIEW", "CONFIRMED"]),
}).refine(
  (biomarker) =>
    biomarker.numericValue !== undefined || biomarker.textValue !== undefined,
  { message: "A biomarker requires a numericValue or textValue." },
);

export const canonicalExtractionResultSchema = z.object({
  schemaVersion: z.literal(CANONICAL_EXTRACTION_SCHEMA_VERSION),
  reportId: z.string().trim().min(1),
  provider: extractionProviderSchema,
  source: z.object({
    fileName: z.string().trim().min(1),
    mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    pageCount: z.number().int().positive().optional(),
  }),
  patient: z.object({
    name: z.string().trim().min(1).optional(),
    age: z.number().int().nonnegative().optional(),
    dateOfBirth: z.string().trim().min(1).optional(),
    sex: z.enum(["male", "female", "other", "unknown"]).optional(),
  }).optional(),
  laboratory: z.object({
    name: z.string().trim().min(1).optional(),
    reportIdentifier: z.string().trim().min(1).optional(),
    specimenType: z.string().trim().min(1).optional(),
    fastingStatus: z.enum(["FASTING", "NON_FASTING", "UNKNOWN"]).optional(),
    collectedAt: z.string().trim().min(1).optional(),
    reportedAt: z.string().trim().min(1).optional(),
  }).optional(),
  biomarkers: z.array(canonicalBiomarkerSchema),
  warnings: z.array(z.object({
    code: z.string().trim().min(1),
    message: z.string().trim().min(1),
    sourcePage: z.number().int().positive().optional(),
  })),
  extractedAt: z.string().datetime(),
});

export type CanonicalBiomarker = z.infer<typeof canonicalBiomarkerSchema>;
export type MetabolicBiomarkerCode = z.infer<
  typeof metabolicBiomarkerCodeSchema
>;
export type CanonicalExtractionResult = z.infer<
  typeof canonicalExtractionResultSchema
>;
