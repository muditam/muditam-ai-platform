import { z } from "zod";
import { metabolicBiomarkerCodeSchema } from "./extraction.js";
import type { NormalizedReport } from "./normalized-report.js";

export const REPORT_COMPARISON_VERSION = "1.0.0" as const;

export interface NormalizedReportContext {
  reportId: string;
  displayName: string;
  uploadedAt: string;
  normalized: NormalizedReport;
}

export const reportComparisonSchema = z.object({
  comparisonVersion: z.literal(REPORT_COMPARISON_VERSION),
  ordering: z.literal("UPLOAD_TIME"),
  reports: z.array(
    z.object({
      reportId: z.string().trim().min(1),
      displayName: z.string().trim().min(1),
      uploadedAt: z.string().datetime(),
      collectedAt: z.string().trim().min(1).optional(),
    }),
  ),
  biomarkers: z.array(
    z.object({
      canonicalCode: metabolicBiomarkerCodeSchema,
      label: z.string().trim().min(1),
      unit: z.string().trim().min(1),
      points: z.array(
        z.object({
          reportId: z.string().trim().min(1),
          displayName: z.string().trim().min(1),
          value: z.number().finite(),
          uploadedAt: z.string().datetime(),
          sourcePage: z.number().int().positive().optional(),
          biomarkerId: z.string().trim().min(1),
        }),
      ).min(2),
      latestChange: z.object({
        previousReportId: z.string().trim().min(1),
        latestReportId: z.string().trim().min(1),
        absolute: z.number().finite(),
        percent: z.number().finite().optional(),
        direction: z.enum(["INCREASED", "DECREASED", "UNCHANGED"]),
      }),
    }),
  ),
  warnings: z.array(z.string().trim().min(1)),
});

export type ReportComparison = z.infer<typeof reportComparisonSchema>;
