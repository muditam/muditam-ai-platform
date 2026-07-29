import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import process from "node:process";
import { ExtractionError, extractPdf } from "./index.js";

async function main(): Promise<void> {
  const [, , inputArgument, outputArgument] = process.argv;
  if (!inputArgument) {
    console.error("Usage: npm run extract -- <input.pdf> [output.json]");
    process.exitCode = 2;
    return;
  }

  const inputPath = resolve(inputArgument);
  const bytes = await readFile(inputPath);
  const result = await extractPdf(bytes, { fileName: basename(inputPath) });
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (outputArgument) {
    const outputPath = resolve(outputArgument);
    await writeFile(outputPath, json, "utf8");
    console.error(`Extraction written to ${outputPath}`);
  } else {
    process.stdout.write(json);
  }
}

main().catch((error: unknown) => {
  if (error instanceof ExtractionError) {
    console.error(JSON.stringify({ code: error.code, message: error.message }));
  } else {
    console.error("Unexpected extraction failure.");
  }
  process.exitCode = 1;
});
