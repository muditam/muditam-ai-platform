import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import process from "node:process";
import { z } from "zod";
import {
  extractPdf,
  normalizeReport,
  structureReport,
  verifyGoldenReport,
} from "./index.js";

const goldenSchema = z.object({
  name: z.string().min(1),
  reviewStatus: z.enum(["DRAFT", "VERIFIED"]),
  expectedReportStatus: z.enum(["NORMALIZED", "REVIEW_REQUIRED"]),
  expectedObservationCount: z.number().int().nonnegative(),
  observations: z.array(
    z.object({
      canonicalCode: z.string().min(1),
      numeric: z.number().finite(),
      unit: z.string().nullable(),
      flag: z
        .enum(["H", "L", "CRITICAL_HIGH", "CRITICAL_LOW"])
        .nullable(),
    }),
  ),
});

const manifestSchema = z.object({
  version: z.string().min(1),
  cases: z.array(
    z.object({
      id: z.string().min(1),
      pdf: z.string().min(1),
      expected: z.string().min(1),
    }),
  ),
});

async function main(): Promise<void> {
  const manifestPath = resolve(
    process.argv[2] ?? "test-fixtures/golden/manifest.json",
  );
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  const rows: Array<Record<string, string | number>> = [];
  let verifiedReports = 0;
  let verifiedBiomarkers = 0;
  let passedBiomarkers = 0;
  let verifiedReportFailures = 0;

  for (const benchmarkCase of manifest.cases) {
    const pdfPath = resolve(benchmarkCase.pdf);
    const golden = goldenSchema.parse(
      JSON.parse(await readFile(resolve(benchmarkCase.expected), "utf8")),
    );
    const report = normalizeReport(
      structureReport(
        await extractPdf(await readFile(pdfPath), {
          fileName: basename(pdfPath),
        }),
      ),
    );
    const verification = verifyGoldenReport(report, golden);
    const passed = verification.checks.filter((check) => check.passed).length;
    rows.push({
      id: benchmarkCase.id,
      review: golden.reviewStatus,
      result: verification.passed ? "MATCH" : "MISMATCH",
      biomarkers: verification.checks.length,
      passed,
    });

    if (golden.reviewStatus === "VERIFIED") {
      verifiedReports += 1;
      verifiedBiomarkers += verification.checks.length;
      passedBiomarkers += passed;
      if (!verification.passed) verifiedReportFailures += 1;
    }
  }

  console.log(`Benchmark manifest ${manifest.version}`);
  console.table(rows);
  const draftReports = manifest.cases.length - verifiedReports;
  console.log(`Verified reports: ${verifiedReports}`);
  console.log(`Draft reports awaiting human confirmation: ${draftReports}`);
  if (verifiedBiomarkers === 0) {
    console.log(
      "Accuracy: NOT AVAILABLE — no independently verified cases yet.",
    );
    return;
  }
  const accuracy = (passedBiomarkers / verifiedBiomarkers) * 100;
  console.log(
    `Verified biomarker accuracy: ${passedBiomarkers}/${verifiedBiomarkers} (${accuracy.toFixed(2)}%)`,
  );
  if (verifiedReportFailures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Benchmark failed.");
  process.exitCode = 1;
});
