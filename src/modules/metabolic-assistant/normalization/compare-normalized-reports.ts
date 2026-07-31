import type { MetabolicBiomarkerCode } from "../contracts/extraction.js";
import {
  REPORT_COMPARISON_VERSION,
  reportComparisonSchema,
  type NormalizedReportContext,
  type ReportComparison,
} from "../contracts/report-comparison.js";

interface ComparisonCandidate {
  reportId: string;
  displayName: string;
  uploadedAt: string;
  biomarkerId: string;
  canonicalCode: MetabolicBiomarkerCode;
  label: string;
  value: number;
  unit: string;
  confidence: number;
  sourcePage?: number;
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function compareNormalizedReports(
  contexts: readonly NormalizedReportContext[],
): ReportComparison {
  const ordered = [...contexts].sort(
    (left, right) =>
      new Date(left.uploadedAt).getTime() -
      new Date(right.uploadedAt).getTime(),
  );
  const candidates: ComparisonCandidate[] = [];
  const warnings: string[] = [];

  for (const context of ordered) {
    const bestByCode = new Map<MetabolicBiomarkerCode, ComparisonCandidate>();
    for (const marker of context.normalized.biomarkers) {
      if (
        marker.canonicalCode === "other" ||
        marker.normalizedNumericValue === undefined ||
        marker.normalizedUnit === undefined
      ) {
        continue;
      }
      const candidate: ComparisonCandidate = {
        reportId: context.reportId,
        displayName: context.displayName,
        uploadedAt: context.uploadedAt,
        biomarkerId: marker.id,
        canonicalCode: marker.canonicalCode,
        label: marker.displayLabel,
        value: marker.normalizedNumericValue,
        unit: marker.normalizedUnit,
        confidence: marker.confidence,
      };
      if (marker.sourcePage !== undefined) {
        candidate.sourcePage = marker.sourcePage;
      }
      const existing = bestByCode.get(marker.canonicalCode);
      if (existing === undefined || candidate.confidence > existing.confidence) {
        bestByCode.set(marker.canonicalCode, candidate);
      }
    }
    candidates.push(...bestByCode.values());
  }

  const codes = new Set(candidates.map((candidate) => candidate.canonicalCode));
  const biomarkers: ReportComparison["biomarkers"] = [];
  for (const code of codes) {
    const codeCandidates = candidates.filter(
      (candidate) => candidate.canonicalCode === code,
    );
    const units = new Set(codeCandidates.map((candidate) => candidate.unit));
    if (units.size > 1) {
      warnings.push(
        `${code} was not compared because the reports use different units.`,
      );
      continue;
    }
    if (codeCandidates.length < 2) continue;
    const previous = codeCandidates.at(-2)!;
    const latest = codeCandidates.at(-1)!;
    const absolute = rounded(latest.value - previous.value);
    const points = codeCandidates.map((candidate) => ({
      reportId: candidate.reportId,
      displayName: candidate.displayName,
      value: candidate.value,
      uploadedAt: candidate.uploadedAt,
      biomarkerId: candidate.biomarkerId,
      ...(candidate.sourcePage === undefined
        ? {}
        : { sourcePage: candidate.sourcePage }),
    }));
    biomarkers.push({
      canonicalCode: code,
      label: latest.label,
      unit: latest.unit,
      points,
      latestChange: {
        previousReportId: previous.reportId,
        latestReportId: latest.reportId,
        absolute,
        ...(previous.value === 0
          ? {}
          : {
              percent: rounded(
                (absolute / Math.abs(previous.value)) * 100,
              ),
            }),
        direction:
          absolute > 0
            ? "INCREASED"
            : absolute < 0
              ? "DECREASED"
              : "UNCHANGED",
      },
    });
  }

  return reportComparisonSchema.parse({
    comparisonVersion: REPORT_COMPARISON_VERSION,
    ordering: "UPLOAD_TIME",
    reports: ordered.map((context) => ({
      reportId: context.reportId,
      displayName: context.displayName,
      uploadedAt: context.uploadedAt,
      ...(context.normalized.collectedAt === undefined
        ? {}
        : { collectedAt: context.normalized.collectedAt }),
    })),
    biomarkers,
    warnings,
  });
}
