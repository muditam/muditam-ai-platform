import { z } from "zod";
import { observationSchema } from "./structured-report.js";

export const NORMALIZED_REPORT_SCHEMA_VERSION = "0.1.0" as const;

const normalizedValueSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("NUMERIC"), numeric: z.number().finite() }),
  z.object({
    type: z.literal("INEQUALITY"),
    comparator: z.enum(["<", "<=", ">", ">="]),
    numeric: z.number().finite(),
  }),
  z.object({
    type: z.literal("RANGE"),
    lower: z.number().finite(),
    upper: z.number().finite(),
  }),
  z.object({ type: z.literal("QUALITATIVE"), text: z.string().min(1) }),
]);

const normalizedRangeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("INTERVAL"),
    lower: z.number().finite(),
    upper: z.number().finite(),
  }),
  z.object({
    type: z.literal("BOUND"),
    comparator: z.enum(["<", "<=", ">", ">="]),
    value: z.number().finite(),
  }),
  z.object({
    type: z.literal("CATEGORICAL_BOUND"),
    label: z.string().min(1),
    comparator: z.enum(["<", "<=", ">", ">="]),
    value: z.number().finite(),
  }),
  z.object({ type: z.literal("TEXT"), text: z.string().min(1) }),
]);

export const normalizedObservationSchema = z.object({
  sourceObservationId: z.string().min(1),
  biomarker: z
    .object({
      canonicalCode: z.string().min(1),
      canonicalName: z.string().min(1),
      panel: z.string().min(1),
    })
    .nullable(),
  mapping: z.object({
    status: z.enum(["MAPPED", "POSSIBLE_MATCH", "AMBIGUOUS", "UNMAPPED"]),
    method: z.enum(["EXACT_ALIAS", "TOKEN_SIGNATURE", "NONE"]),
    matchedAlias: z.string().optional(),
    suggestedCanonicalCode: z.string().optional(),
    confidence: z.number().min(0).max(1),
    evidence: z.array(z.string().min(1)),
    alternatives: z.array(
      z.object({
        canonicalCode: z.string().min(1),
        confidence: z.number().min(0).max(1),
      }),
    ),
  }),
  raw: observationSchema.shape.raw,
  normalized: z.object({
    value: normalizedValueSchema,
    unit: z.string().nullable(),
    referenceRange: normalizedRangeSchema.nullable(),
  }),
  validation: z.object({
    status: z.enum(["VALID", "REVIEW_REQUIRED"]),
    issues: z.array(
      z.object({
        code: z.enum([
          "UNMAPPED_BIOMARKER",
          "UNIT_MISMATCH",
          "UNPARSED_REFERENCE_RANGE",
          "DUPLICATE_CONFLICT",
        ]),
        message: z.string().min(1),
      }),
    ),
  }),
  confidence: z.object({
    mapping: z.number().min(0).max(1),
    layout: z.number().min(0).max(1),
    valueParsing: z.number().min(0).max(1),
    unitCompatibility: z.number().min(0).max(1),
    overall: z.number().min(0).max(1),
  }),
  decision: z.enum([
    "AUTO_ACCEPT",
    "USER_CONFIRMATION",
    "REVIEW_REQUIRED",
  ]),
  source: observationSchema.shape.source,
});

export const normalizedReportSchema = z.object({
  schemaVersion: z.literal(NORMALIZED_REPORT_SCHEMA_VERSION),
  documentId: z.string().min(1),
  sourceStructuredSchemaVersion: z.string().min(1),
  catalogueVersion: z.string().min(1),
  sourceLayoutAnalysis: z.object({
    strategy: z.enum(["HEADER", "CLUSTERED", "FALLBACK"]),
    confidence: z.number().min(0).max(1),
    evidenceRowCount: z.number().int().nonnegative(),
    anchors: z.object({
      description: z.number().min(0).max(1),
      value: z.number().min(0).max(1),
      unit: z.number().min(0).max(1),
      referenceRange: z.number().min(0).max(1),
    }),
  }),
  status: z.enum(["NORMALIZED", "REVIEW_REQUIRED"]),
  processing: z.object({
    status: z.enum(["COMPLETE", "PARTIAL", "UNREADABLE"]),
    totalPages: z.number().int().positive(),
    pdfTextPages: z.array(z.number().int().positive()),
    visionPages: z.array(z.number().int().positive()),
    failedPages: z.array(z.number().int().positive()),
    warnings: z.array(z.string().min(1)),
  }),
  observations: z.array(normalizedObservationSchema),
  unclassifiedContent: z.array(
    z.object({
      text: z.string().min(1),
      source: observationSchema.shape.source,
    }),
  ),
  statistics: z.object({
    observationCount: z.number().int().nonnegative(),
    mappedCount: z.number().int().nonnegative(),
    possibleMatchCount: z.number().int().nonnegative(),
    ambiguousCount: z.number().int().nonnegative(),
    unmappedCount: z.number().int().nonnegative(),
    reviewRequiredCount: z.number().int().nonnegative(),
    autoAcceptedCount: z.number().int().nonnegative(),
    userConfirmationCount: z.number().int().nonnegative(),
  }),
});

export type NormalizedObservation = z.infer<
  typeof normalizedObservationSchema
>;
export type NormalizedReport = z.infer<typeof normalizedReportSchema>;
