import { z } from "zod";

export const IMAGE_EXTRACTION_SCHEMA_VERSION = "1.0.0" as const;

const nullableText = z.string().nullable();

export const imageExtractionPayloadSchema = z.object({
  document: z.object({
    isBloodReport: z.boolean(),
    quality: z.enum(["GOOD", "READABLE", "POOR", "UNREADABLE"]),
  }),
  observations: z.array(
    z.object({
      rawName: z.string().min(1),
      rawValue: z.string().min(1),
      unit: nullableText,
      referenceRange: nullableText,
      rawFlag: nullableText,
      method: nullableText,
      confidence: z.number().min(0).max(1),
      evidenceText: nullableText,
    }),
  ),
  warnings: z.array(z.string()),
});

export type ImageExtractionPayload = z.infer<
  typeof imageExtractionPayloadSchema
>;
