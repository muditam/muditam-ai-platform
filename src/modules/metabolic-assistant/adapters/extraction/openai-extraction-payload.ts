import { z } from "zod";
import {
  biomarkerPanelSchema,
  metabolicBiomarkerCodeSchema,
} from "../../contracts/extraction.js";

const nullableText = z.string().nullable();
const nullableNumber = z.number().finite().nullable();
const nullablePage = z.number().int().positive().nullable();

/**
 * This is the exact structured payload requested from OpenAI.
 *
 * Provider-owned metadata such as reportId, SHA-256, model, prompt version,
 * response ID, and extraction time are deliberately not model-generated.
 * The adapter adds those trusted values after receiving this payload.
 */
export const openAIExtractionPayloadSchema = z.object({
  document: z.object({
    isBloodReport: z.boolean(),
    pageCount: nullablePage,
    reportTitle: nullableText,
  }),
  patient: z.object({
    name: nullableText,
    age: z.number().int().nonnegative().nullable(),
    dateOfBirth: nullableText,
    sex: z.enum(["male", "female", "other", "unknown"]).nullable(),
  }),
  laboratory: z.object({
    name: nullableText,
    reportIdentifier: nullableText,
    specimenType: nullableText,
    fastingStatus: z
      .enum(["FASTING", "NON_FASTING", "UNKNOWN"])
      .nullable(),
    collectedAt: nullableText,
    reportedAt: nullableText,
  }),
  biomarkers: z.array(
    z.object({
      canonicalCode: metabolicBiomarkerCodeSchema,
      panel: biomarkerPanelSchema,
      sourceLabel: z.string().min(1),
      numericValue: nullableNumber,
      textValue: nullableText,
      unit: nullableText,
      sourceReferenceRange: nullableText,
      referenceLower: nullableNumber,
      referenceUpper: nullableNumber,
      sourceFlag: nullableText,
      status: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL", "UNKNOWN"]),
      confidence: z.number().min(0).max(1),
      sourcePage: nullablePage,
      evidenceText: nullableText,
    }).refine(
      (biomarker) =>
        biomarker.numericValue !== null || biomarker.textValue !== null,
      { message: "Every biomarker requires a numeric or text value." },
    ),
  ),
  warnings: z.array(
    z.object({
      code: z.string().min(1),
      message: z.string().min(1),
      sourcePage: nullablePage,
    }),
  ),
});

export type OpenAIExtractionPayload = z.infer<
  typeof openAIExtractionPayloadSchema
>;
