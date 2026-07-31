import { z } from "zod";
import {
  biomarkerPanelSchema,
  metabolicBiomarkerCodeSchema,
} from "./extraction.js";

export const BASIC_NORMALIZATION_VERSION = "1.0.0" as const;

export const normalizedBiomarkerSchema = z.object({
  id: z.string().trim().min(1),
  canonicalCode: metabolicBiomarkerCodeSchema,
  panel: biomarkerPanelSchema,
  sourceLabel: z.string().trim().min(1),
  displayLabel: z.string().trim().min(1),
  value: z.union([z.number().finite(), z.string().trim().min(1)]),
  normalizedNumericValue: z.number().finite().optional(),
  normalizedUnit: z.string().trim().min(1).optional(),
  sourceUnit: z.string().trim().min(1).optional(),
  sourceReferenceRange: z.string().trim().min(1).optional(),
  status: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL", "UNKNOWN"]),
  confidence: z.number().min(0).max(1),
  sourcePage: z.number().int().positive().optional(),
  reviewState: z.enum(["UNREVIEWED", "NEEDS_REVIEW", "CONFIRMED"]),
  usableForRules: z.boolean(),
  normalizationNotes: z.array(z.string().trim().min(1)),
});

export const normalizedReportSchema = z.object({
  normalizationVersion: z.literal(BASIC_NORMALIZATION_VERSION),
  extractionSchemaVersion: z.string().trim().min(1),
  reportId: z.string().trim().min(1),
  reportReviewPending: z.boolean(),
  fastingStatus: z
    .enum(["FASTING", "NON_FASTING", "UNKNOWN"])
    .optional(),
  collectedAt: z.string().trim().min(1).optional(),
  biomarkers: z.array(normalizedBiomarkerSchema),
  extractionWarnings: z.array(
    z.object({
      code: z.string().trim().min(1),
      message: z.string().trim().min(1),
      sourcePage: z.number().int().positive().optional(),
    }),
  ),
});

export type NormalizedBiomarker = z.infer<
  typeof normalizedBiomarkerSchema
>;
export type NormalizedReport = z.infer<typeof normalizedReportSchema>;
