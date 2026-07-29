import { z } from "zod";
import { boundingBoxSchema } from "./extracted-document.js";

export const STRUCTURED_REPORT_SCHEMA_VERSION = "0.1.0" as const;

const sourceReferenceSchema = z.object({
  pageNumber: z.number().int().positive(),
  lineId: z.string().min(1),
  itemIds: z.array(z.string().min(1)),
  boundingBox: boundingBoxSchema,
});

const parsedValueSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("NUMERIC"), numericValue: z.number().finite() }),
  z.object({
    type: z.literal("INEQUALITY"),
    comparator: z.enum(["<", "<=", ">", ">="]),
    numericValue: z.number().finite(),
  }),
  z.object({
    type: z.literal("RANGE"),
    lower: z.number().finite(),
    upper: z.number().finite(),
  }),
  z.object({ type: z.literal("QUALITATIVE"), text: z.string().min(1) }),
]);

export const observationSchema = z.object({
  id: z.string().min(1),
  section: z.string().optional(),
  raw: z.object({
    name: z.string().min(1),
    value: z.string().min(1),
    unit: z.string().optional(),
    referenceRange: z.string().optional(),
    flag: z.enum(["H", "L", "CRITICAL_HIGH", "CRITICAL_LOW"]).optional(),
    method: z.string().optional(),
  }),
  parsedValue: parsedValueSchema,
  source: sourceReferenceSchema,
});

export const structuredReportSchema = z.object({
  schemaVersion: z.literal(STRUCTURED_REPORT_SCHEMA_VERSION),
  documentId: z.string().min(1),
  sourceExtractionSchemaVersion: z.string().min(1),
  status: z.enum(["STRUCTURED", "PARTIAL"]),
  panels: z.array(
    z.object({
      name: z.string().min(1),
      observations: z.array(observationSchema),
    }),
  ),
  unclassifiedContent: z.array(
    z.object({
      text: z.string().min(1),
      source: sourceReferenceSchema,
    }),
  ),
  statistics: z.object({
    observationCount: z.number().int().nonnegative(),
    classifiedLineCount: z.number().int().nonnegative(),
    unclassifiedLineCount: z.number().int().nonnegative(),
  }),
});

export type Observation = z.infer<typeof observationSchema>;
export type StructuredReport = z.infer<typeof structuredReportSchema>;
