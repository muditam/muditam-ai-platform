import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import process from "node:process";
import {
  ExtractionError,
  extractImageReport,
  extractPdf,
  mergeStructuredReports,
  normalizeReport,
  OpenAIImageObservationExtractor,
  renderPdfPages,
  structureReport,
  type SupportedImageMimeType,
} from "./index.js";

const HOST = process.env.MUDITAM_REVIEW_HOST ?? "127.0.0.1";
const PORT = Number(process.env.MUDITAM_REVIEW_PORT ?? 4173);
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_VISION_PAGES = 10;
const VISION_CONCURRENCY = 2;
const htmlPath = resolve("local-test-ui/index.html");

function logEvent(
  event: string,
  fields: Record<string, unknown> = {},
): void {
  console.info(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      service: "muditam-report-extractor",
      event,
      ...fields,
    }),
  );
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(values.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = {
          status: "fulfilled",
          value: await operation(values[index] as T),
        };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, values.length) },
      () => worker(),
    ),
  );
  return results;
}

function json(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-File-Name",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  response.end(JSON.stringify(body));
}

async function readRequest(
  request: IncomingMessage,
): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BYTES) {
      throw new ExtractionError(
        "FILE_TOO_LARGE",
        `PDF exceeds the ${MAX_BYTES} byte local review limit.`,
      );
    }
    chunks.push(buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  requestId: string,
): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, X-File-Name",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    });
    response.end();
    return;
  }
  if (request.method === "GET" && url.pathname === "/") {
    const html = await readFile(htmlPath);
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(html);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    json(response, 200, { status: "ok" });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/process") {
    const startedAt = Date.now();
    const contentType = request.headers["content-type"]?.split(";")[0]?.trim();
    const encodedName = request.headers["x-file-name"];
    const fileName =
      typeof encodedName === "string"
        ? decodeURIComponent(encodedName)
        : "uploaded-report";
    const bytes = await readRequest(request);
    logEvent("report.received", {
      requestId,
      mimeType: contentType ?? "unknown",
      byteSize: bytes.byteLength,
    });
    const imageTypes = new Set<SupportedImageMimeType>([
      "image/png",
      "image/jpeg",
    ]);
    if (imageTypes.has(contentType as SupportedImageMimeType)) {
      const apiKey =
        process.env.MUDITAM_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new ExtractionError(
          "INVALID_CONFIGURATION",
          "Set MUDITAM_OPENAI_API_KEY to enable image report extraction.",
        );
      }
      logEvent("vision.extraction.started", {
        requestId,
        provider: "openai",
        model:
          process.env.MUDITAM_OPENAI_VISION_MODEL ?? "gpt-5.6-luna",
      });
      const structured = await extractImageReport(
        {
          bytes,
          fileName,
          mimeType: contentType as SupportedImageMimeType,
        },
        new OpenAIImageObservationExtractor({ apiKey }),
      );
      const unreadable = structured.statistics.observationCount === 0;
      const normalized = normalizeReport(structured, {
        status: unreadable ? "UNREADABLE" : "COMPLETE",
        totalPages: 1,
        pdfTextPages: [],
        visionPages: unreadable ? [] : [1],
        failedPages: unreadable ? [1] : [],
        warnings: unreadable
          ? ["Couldn’t read your report. Please contact our dietitian."]
          : [],
      });
      logEvent("vision.extraction.completed", {
        requestId,
        durationMs: Date.now() - startedAt,
        observationCount: normalized.statistics.observationCount,
        autoAcceptedCount: normalized.statistics.autoAcceptedCount,
        userConfirmationCount: normalized.statistics.userConfirmationCount,
        reviewRequiredCount: normalized.statistics.reviewRequiredCount,
      });
      json(response, 200, normalized);
      return;
    }
    if (contentType !== "application/pdf") {
      json(response, 415, {
        error:
          "DOCX processing is not configured yet. Upload a PDF, PNG, or JPEG report.",
        code: "UNSUPPORTED_DOCUMENT_TYPE",
        receivedMimeType: contentType ?? null,
      });
      return;
    }
    logEvent("pdf.text_extraction.started", { requestId });
    const extracted = await extractPdf(bytes, { fileName });
    logEvent("pdf.text_extraction.completed", {
      requestId,
      pageCount: extracted.pages.length,
      pagesExtracted: extracted.quality.pagesExtracted,
      pagesRequiringOcr: extracted.quality.pagesRequiringOcr,
      qualityStatus: extracted.quality.status,
    });
    const digitalStructured = structureReport(extracted);
    const ocrPages = extracted.quality.pagesRequiringOcr;
    const pdfTextPages = extracted.pages
      .filter(
        (page) =>
          page.quality.status === "GOOD" ||
          page.quality.status === "SUSPECT",
      )
      .map((page) => page.pageNumber);
    let visionReports: Awaited<ReturnType<typeof extractImageReport>>[] = [];
    let visionPages: number[] = [];
    let failedPages: number[] = [];
    const processingWarnings: string[] = [];

    if (ocrPages.length > 0) {
      const apiKey =
        process.env.MUDITAM_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new ExtractionError(
          "INVALID_CONFIGURATION",
          "Set MUDITAM_OPENAI_API_KEY to process scanned PDF pages.",
        );
      }
      const pagesToProcess = ocrPages.slice(0, MAX_VISION_PAGES);
      if (ocrPages.length > MAX_VISION_PAGES) {
        const skipped = ocrPages.slice(MAX_VISION_PAGES);
        failedPages.push(...skipped);
        processingWarnings.push(
          `${skipped.length} scanned pages exceeded the ${MAX_VISION_PAGES}-page vision limit.`,
        );
      }
      logEvent("pdf.vision_render.started", {
        requestId,
        pages: pagesToProcess,
      });
      const renderedPages = await renderPdfPages(bytes, pagesToProcess);
      logEvent("pdf.vision_render.completed", {
        requestId,
        pageCount: renderedPages.length,
      });
      const extractor = new OpenAIImageObservationExtractor({ apiKey });
      const pageResults = await mapWithConcurrency(
        renderedPages,
        VISION_CONCURRENCY,
        async (page) => {
          logEvent("pdf.vision_page.started", {
            requestId,
            pageNumber: page.pageNumber,
          });
          let lastError: unknown;
          for (let attempt = 1; attempt <= 2; attempt += 1) {
            try {
              const report = await extractImageReport(
                {
                  bytes: page.pngBytes,
                  fileName: `report-page-${page.pageNumber}.png`,
                  mimeType: "image/png",
                  sourcePageNumber: page.pageNumber,
                },
                extractor,
              );
              logEvent("pdf.vision_page.completed", {
                requestId,
                pageNumber: page.pageNumber,
                attempt,
                observationCount: report.statistics.observationCount,
              });
              return { pageNumber: page.pageNumber, report };
            } catch (error) {
              lastError = error;
              if (
                !(error instanceof ExtractionError) ||
                error.code !== "VISION_PROVIDER_ERROR" ||
                attempt === 2
              ) {
                throw error;
              }
              logEvent("pdf.vision_page.retrying", {
                requestId,
                pageNumber: page.pageNumber,
                attempt,
              });
            }
          }
          throw lastError;
        },
      );
      pageResults.forEach((result, index) => {
        const pageNumber = renderedPages[index]?.pageNumber;
        if (pageNumber === undefined) return;
        if (result.status === "rejected") {
          failedPages.push(pageNumber);
          processingWarnings.push(`Page ${pageNumber} could not be read.`);
          return;
        }
        visionReports.push(result.value.report);
        if (result.value.report.statistics.observationCount > 0) {
          visionPages.push(pageNumber);
        } else {
          failedPages.push(pageNumber);
          processingWarnings.push(`Page ${pageNumber} could not be read.`);
        }
      });
    }

    const structured = mergeStructuredReports(
      digitalStructured,
      visionReports,
    );
    const unreadable = structured.statistics.observationCount === 0;
    const partial = failedPages.length > 0;
    if (unreadable) {
      processingWarnings.unshift(
        "Couldn’t read your report. Please contact our dietitian.",
      );
    } else if (partial) {
      processingWarnings.unshift(
        "Some pages could not be read. Reliable extracted values are shown below.",
      );
    }
    const normalized = normalizeReport(structured, {
      status: unreadable ? "UNREADABLE" : partial ? "PARTIAL" : "COMPLETE",
      totalPages: extracted.pages.length,
      pdfTextPages,
      visionPages,
      failedPages: [...new Set(failedPages)].sort((a, b) => a - b),
      warnings: processingWarnings,
    });
    logEvent("report.normalization.completed", {
      requestId,
      durationMs: Date.now() - startedAt,
      observationCount: normalized.statistics.observationCount,
      autoAcceptedCount: normalized.statistics.autoAcceptedCount,
      userConfirmationCount: normalized.statistics.userConfirmationCount,
      reviewRequiredCount: normalized.statistics.reviewRequiredCount,
    });
    json(response, 200, normalized);
    return;
  }

  json(response, 404, { error: "Not found." });
}

const server = createServer((request, response) => {
  const requestId = randomUUID();
  response.setHeader("X-Request-Id", requestId);
  handle(request, response, requestId).catch((error: unknown) => {
    if (error instanceof ExtractionError) {
      const status =
        error.code === "INVALID_CONFIGURATION"
          ? 503
          : error.code === "VISION_PROVIDER_ERROR"
            ? 502
            : 400;
      logEvent("report.processing.failed", {
        requestId,
        code: error.code,
      });
      json(response, status, { error: error.message, code: error.code });
      return;
    }
    logEvent("report.processing.failed", {
      requestId,
      code: "UNEXPECTED_ERROR",
    });
    console.error(error);
    json(response, 500, { error: "Could not process this report." });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Muditam report reviewer: http://${HOST}:${PORT}`);
  console.log("Press Ctrl+C to stop.");
});
