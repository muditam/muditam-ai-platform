import type { NormalizedReport } from "../contracts/normalized-report.js";

export interface GoldenObservation {
  canonicalCode: string;
  numeric: number;
  unit: string | null;
  flag: "H" | "L" | "CRITICAL_HIGH" | "CRITICAL_LOW" | null;
}

export interface GoldenReport {
  name: string;
  reviewStatus: "DRAFT" | "VERIFIED";
  expectedReportStatus: NormalizedReport["status"];
  expectedObservationCount: number;
  observations: GoldenObservation[];
}

export interface GoldenCheck {
  canonicalCode: string;
  expected: string;
  actual: string;
  passed: boolean;
}

export interface GoldenVerification {
  passed: boolean;
  checks: GoldenCheck[];
  errors: string[];
}

function display(
  numeric: number | undefined,
  unit: string | null | undefined,
  flag: string | null | undefined,
): string {
  return `${numeric ?? "—"} ${unit ?? "—"} flag=${flag ?? "—"}`;
}

export function verifyGoldenReport(
  report: NormalizedReport,
  golden: GoldenReport,
): GoldenVerification {
  const errors: string[] = [];
  if (report.status !== golden.expectedReportStatus) {
    errors.push(
      `Expected report status ${golden.expectedReportStatus}, received ${report.status}.`,
    );
  }
  if (report.statistics.observationCount !== golden.expectedObservationCount) {
    errors.push(
      `Expected ${golden.expectedObservationCount} observations, received ${report.statistics.observationCount}.`,
    );
  }

  const checks = golden.observations.map((expected) => {
    const matches = report.observations.filter(
      (observation) =>
        observation.biomarker?.canonicalCode === expected.canonicalCode,
    );
    const actual = matches[0];
    const numeric =
      actual?.normalized.value.type === "NUMERIC"
        ? actual.normalized.value.numeric
        : undefined;
    const flag = actual?.raw.flag ?? null;
    const passed =
      matches.length === 1 &&
      numeric === expected.numeric &&
      actual?.normalized.unit === expected.unit &&
      flag === expected.flag;
    return {
      canonicalCode: expected.canonicalCode,
      expected: display(expected.numeric, expected.unit, expected.flag),
      actual:
        matches.length === 0
          ? "MISSING"
          : matches.length > 1
            ? `DUPLICATE (${matches.length})`
            : display(numeric, actual?.normalized.unit, flag),
      passed,
    };
  });

  return {
    passed: errors.length === 0 && checks.every((check) => check.passed),
    checks,
    errors,
  };
}
