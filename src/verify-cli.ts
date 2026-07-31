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

async function main(): Promise<void> {
  const [, , pdfArgument, goldenArgument] = process.argv;
  if (!pdfArgument || !goldenArgument) {
    console.error(
      "Usage: npm run verify:report -- <report.pdf> <expected.json>",
    );
    process.exitCode = 2;
    return;
  }

  const pdfPath = resolve(pdfArgument);
  const goldenPath = resolve(goldenArgument);
  const golden = goldenSchema.parse(
    JSON.parse(await readFile(goldenPath, "utf8")),
  );
  const report = normalizeReport(
    structureReport(
      await extractPdf(await readFile(pdfPath), {
        fileName: basename(pdfPath),
      }),
    ),
  );
  const verification = verifyGoldenReport(report, golden);

  console.log(`Golden test: ${golden.name} [${golden.reviewStatus}]`);
  console.table(
    verification.checks.map((check) => ({
      result: check.passed ? "PASS" : "FAIL",
      biomarker: check.canonicalCode,
      expected: check.expected,
      actual: check.actual,
    })),
  );
  for (const error of verification.errors) console.error(`FAIL: ${error}`);
  console.log(
    verification.passed
      ? `PASS: ${verification.checks.length} biomarkers and report totals matched.`
      : "FAIL: Report did not match the golden expectations.",
  );
  if (golden.reviewStatus === "DRAFT") {
    console.log(
      "NOTE: This case is a draft and does not count as independent accuracy evidence.",
    );
  }
  if (!verification.passed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Verification failed.");
  process.exitCode = 1;
});
