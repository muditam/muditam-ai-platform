import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import process from "node:process";
import {
  ExtractionError,
  extractPdf,
  normalizeReport,
  structureReport,
} from "./index.js";

async function main(): Promise<void> {
  const [, , inputArgument, outputArgument] = process.argv;
  if (!inputArgument) {
    console.error("Usage: npm run process -- <input.pdf> [output.json]");
    process.exitCode = 2;
    return;
  }

  const inputPath = resolve(inputArgument);
  const bytes = await readFile(inputPath);
  const extracted = await extractPdf(bytes, { fileName: basename(inputPath) });
  const structured = structureReport(extracted);
  const normalized = normalizeReport(structured);
  const json = `${JSON.stringify(normalized, null, 2)}\n`;

  if (outputArgument) {
    const outputPath = resolve(outputArgument);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, json, "utf8");
    console.error(`Normalized report written to ${outputPath}`);
  } else {
    process.stdout.write(json);
  }
}

main().catch((error: unknown) => {
  if (error instanceof ExtractionError) {
    console.error(JSON.stringify({ code: error.code, message: error.message }));
  } else {
    console.error(
      error instanceof Error ? error.message : "Unexpected processing failure.",
    );
  }
  process.exitCode = 1;
});
