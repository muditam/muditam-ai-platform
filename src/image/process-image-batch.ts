import { IMAGE_EXTRACTION_SCHEMA_VERSION } from "../contracts/image-extraction.js";
import {
  STRUCTURED_REPORT_SCHEMA_VERSION,
  structuredReportSchema,
  type StructuredReport,
} from "../contracts/structured-report.js";
import { ExtractionError } from "../errors/extraction-error.js";
import { mergeStructuredReports } from "../report/merge-structured-reports.js";
import {
  extractImageReport,
  type ImageObservationExtractor,
  type SupportedImageMimeType,
} from "./image-report-extractor.js";

export const MAX_IMAGE_BATCH_PAGES = 10;
export const MAX_IMAGE_PAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_BATCH_CONCURRENCY = 2;

export interface ImageBatchPage {
  bytes: Uint8Array;
  fileName: string;
  mimeType: SupportedImageMimeType;
}

export interface ImageBatchResult {
  structured: StructuredReport;
  successfulPages: number[];
  failedPages: number[];
}

function emptyImageBatchReport(): StructuredReport {
  return structuredReportSchema.parse({
    schemaVersion: STRUCTURED_REPORT_SCHEMA_VERSION,
    documentId: "image-batch-unreadable",
    sourceExtractionSchemaVersion: IMAGE_EXTRACTION_SCHEMA_VERSION,
    status: "PARTIAL",
    layoutAnalysis: {
      strategy: "FALLBACK",
      confidence: 0,
      evidenceRowCount: 0,
      anchors: {
        description: 0,
        value: 0.5,
        unit: 0.7,
        referenceRange: 0.85,
      },
    },
    panels: [],
    unclassifiedContent: [],
    statistics: {
      observationCount: 0,
      classifiedLineCount: 0,
      unclassifiedLineCount: 0,
    },
  });
}

async function withConcurrency<T, R>(
  values: T[],
  operation: (value: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(values.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      try {
        results[index] = {
          status: "fulfilled",
          value: await operation(values[index] as T, index),
        };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(IMAGE_BATCH_CONCURRENCY, values.length) },
      () => worker(),
    ),
  );
  return results;
}

export async function processImageBatch(
  pages: ImageBatchPage[],
  extractor: ImageObservationExtractor,
  onEvent?: (
    event: "started" | "retrying" | "completed" | "failed",
    pageNumber: number,
    fields?: Record<string, unknown>,
  ) => void,
): Promise<ImageBatchResult> {
  if (pages.length === 0 || pages.length > MAX_IMAGE_BATCH_PAGES) {
    throw new ExtractionError(
      "INVALID_IMAGE",
      `Upload between 1 and ${MAX_IMAGE_BATCH_PAGES} report photos.`,
    );
  }
  pages.forEach((page) => {
    if (page.bytes.byteLength > MAX_IMAGE_PAGE_BYTES) {
      throw new ExtractionError(
        "FILE_TOO_LARGE",
        `${page.fileName} exceeds the 10 MB per-photo limit.`,
      );
    }
  });

  const settled = await withConcurrency(pages, async (page, index) => {
    const pageNumber = index + 1;
    onEvent?.("started", pageNumber);
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const report = await extractImageReport(
          { ...page, sourcePageNumber: pageNumber },
          extractor,
        );
        onEvent?.("completed", pageNumber, {
          attempt,
          observationCount: report.statistics.observationCount,
        });
        return report;
      } catch (error) {
        lastError = error;
        if (
          !(error instanceof ExtractionError) ||
          error.code !== "VISION_PROVIDER_ERROR" ||
          attempt === 2
        ) {
          throw error;
        }
        onEvent?.("retrying", pageNumber, { attempt });
      }
    }
    throw lastError;
  });

  const reports: StructuredReport[] = [];
  const successfulPages: number[] = [];
  const failedPages: number[] = [];
  settled.forEach((result, index) => {
    const pageNumber = index + 1;
    if (
      result.status === "rejected" ||
      result.value.statistics.observationCount === 0
    ) {
      failedPages.push(pageNumber);
      onEvent?.("failed", pageNumber);
      return;
    }
    reports.push(result.value);
    successfulPages.push(pageNumber);
  });

  const structured =
    reports.length === 0
      ? emptyImageBatchReport()
      : mergeStructuredReports(reports[0] as StructuredReport, reports.slice(1));
  return { structured, successfulPages, failedPages };
}
