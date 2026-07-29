import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import { performance } from "node:perf_hooks";
import {
  getDocument,
  OPS,
  PasswordResponses,
  version as pdfjsVersion,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  EXTRACTION_SCHEMA_VERSION,
  extractedDocumentSchema,
  type ExtractedDocument,
  type ExtractedPage,
  type PositionedTextItem,
} from "../contracts/extracted-document.js";
import { ExtractionError } from "../errors/extraction-error.js";
import { reconstructLines } from "./layout.js";
import { assessPageQuality } from "./quality.js";

const require = createRequire(import.meta.url);
const pdfjsDirectory = dirname(require.resolve("pdfjs-dist/package.json"));
const standardFontDataUrl = `${join(pdfjsDirectory, "standard_fonts")}${sep}`;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_PAGES = 100;

interface PdfTextItem {
  str: string;
  dir: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
}

export interface ExtractPdfOptions {
  fileName?: string;
  documentId?: string;
  maxBytes?: number;
  maxPages?: number;
  password?: string;
}

function assertPdfInput(bytes: Uint8Array, maxBytes: number): void {
  if (bytes.byteLength === 0) {
    throw new ExtractionError("EMPTY_FILE", "The supplied PDF is empty.");
  }
  if (bytes.byteLength > maxBytes) {
    throw new ExtractionError(
      "FILE_TOO_LARGE",
      `The PDF exceeds the ${maxBytes}-byte processing limit.`,
      { byteSize: bytes.byteLength, maxBytes },
    );
  }
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  if (!header.includes("%PDF-")) {
    throw new ExtractionError(
      "INVALID_PDF",
      "The supplied file does not contain a valid PDF header.",
    );
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function mapMetadata(
  info: Record<string, unknown>,
  metadata: { get(name: string): string | null } | null,
): ExtractedDocument["metadata"] {
  const result: ExtractedDocument["metadata"] = {};
  const values = {
    title: optionalString(info.Title),
    author: optionalString(info.Author),
    subject: optionalString(info.Subject),
    creator: optionalString(info.Creator),
    producer: optionalString(info.Producer),
    creationDate: optionalString(info.CreationDate),
    modificationDate: optionalString(info.ModDate),
    language: optionalString(metadata?.get("dc:language")),
  };
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) Object.assign(result, { [key]: value });
  }
  return result;
}

function isPdfTextItem(value: unknown): value is PdfTextItem {
  return (
    typeof value === "object" &&
    value !== null &&
    "str" in value &&
    typeof value.str === "string" &&
    "transform" in value &&
    Array.isArray(value.transform)
  );
}

function mapTextItem(
  item: PdfTextItem,
  pageNumber: number,
  itemNumber: number,
  pageHeight: number,
): PositionedTextItem {
  const [a = 0, b = 0, c = 0, d = 0, x = 0, baseline = 0] = item.transform;
  const fontSize = Math.max(item.height, Math.hypot(c, d), Math.hypot(a, b));
  const height = Math.max(0, item.height || fontSize);
  return {
    id: `p${pageNumber}-i${itemNumber}`,
    text: item.str,
    boundingBox: {
      x,
      y: Math.max(0, pageHeight - baseline - height),
      width: Math.max(0, item.width),
      height,
    },
    baselineY: Math.max(0, pageHeight - baseline),
    fontName: item.fontName,
    fontSize,
    direction:
      item.dir === "rtl" || item.dir === "ttb" ? item.dir : "ltr",
    hasEndOfLine: item.hasEOL,
  };
}

async function countImageObjects(page: {
  getOperatorList(): Promise<{ fnArray: number[] }>;
}): Promise<number> {
  const operators = await page.getOperatorList();
  const imageOperators = new Set<number>([
    OPS.paintImageXObject,
    OPS.paintInlineImageXObject,
    OPS.paintImageMaskXObject,
    OPS.paintSolidColorImageMask,
  ]);
  return operators.fnArray.filter((operator) => imageOperators.has(operator))
    .length;
}

function normalizePdfError(error: unknown): ExtractionError {
  if (error instanceof ExtractionError) return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === PasswordResponses.NEED_PASSWORD ||
      error.code === PasswordResponses.INCORRECT_PASSWORD)
  ) {
    return new ExtractionError(
      "PASSWORD_PROTECTED",
      "The PDF requires a valid password.",
      undefined,
      { cause: error },
    );
  }
  return new ExtractionError(
    "PDF_PARSE_FAILED",
    "PDF.js could not parse the supplied document.",
    undefined,
    { cause: error },
  );
}

export async function extractPdf(
  input: Uint8Array | Buffer,
  options: ExtractPdfOptions = {},
): Promise<ExtractedDocument> {
  const bytes = new Uint8Array(input);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  assertPdfInput(bytes, maxBytes);
  const startedAt = performance.now();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const loadingTask = getDocument({
    data: bytes.slice(),
    password: options.password,
    standardFontDataUrl,
    useSystemFonts: false,
  });

  try {
    const document = await loadingTask.promise;
    if (document.numPages > maxPages) {
      throw new ExtractionError(
        "PAGE_LIMIT_EXCEEDED",
        `The PDF has ${document.numPages} pages, exceeding the ${maxPages}-page limit.`,
        { pageCount: document.numPages, maxPages },
      );
    }

    const pages: ExtractedPage[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const [textContent, imageObjects] = await Promise.all([
        page.getTextContent({
          includeMarkedContent: false,
          disableNormalization: false,
        }),
        countImageObjects(page),
      ]);
      const items = textContent.items
        .filter(isPdfTextItem)
        .map((item, index) =>
          mapTextItem(item, pageNumber, index + 1, viewport.height),
        );
      const lines = reconstructLines(items, pageNumber);
      pages.push({
        pageNumber,
        width: viewport.width,
        height: viewport.height,
        rotation: viewport.rotation,
        extractionMethod: "PDF_TEXT",
        items,
        lines,
        plainText: lines.map((line) => line.text).join("\n"),
        quality: assessPageQuality(pageNumber, items, imageObjects),
      });
      page.cleanup();
    }

    const documentMetadata = await document.getMetadata();
    const pagesRequiringOcr = pages
      .filter((page) => page.quality.status === "OCR_REQUIRED")
      .map((page) => page.pageNumber);
    const emptyPages = pages
      .filter((page) => page.quality.status === "EMPTY")
      .map((page) => page.pageNumber);
    const suspectPages = pages.filter(
      (page) => page.quality.status === "SUSPECT",
    );
    const pagesExtracted = pages.filter(
      (page) =>
        page.quality.status === "GOOD" || page.quality.status === "SUSPECT",
    ).length;
    const warnings = pages.flatMap((page) => page.quality.warnings);
    if (
      pagesRequiringOcr.length > 0 &&
      pagesRequiringOcr.length < pages.length
    ) {
      warnings.push({
        code: "MIXED_EXTRACTION_QUALITY",
        message: "Some pages require OCR while other pages contain usable text.",
      });
    }
    const qualityStatus: ExtractedDocument["quality"]["status"] =
      pagesRequiringOcr.length === pages.length
        ? "OCR_REQUIRED"
        : pagesRequiringOcr.length > 0 ||
            suspectPages.length > 0 ||
            emptyPages.length > 0
          ? "PARTIAL"
          : "EXTRACTED";

    const result: ExtractedDocument = {
      schemaVersion: EXTRACTION_SCHEMA_VERSION,
      documentId: options.documentId ?? sha256,
      source: {
        fileName: options.fileName ?? "document.pdf",
        mimeType: "application/pdf",
        byteSize: bytes.byteLength,
        sha256,
      },
      metadata: mapMetadata(
        documentMetadata.info as unknown as Record<string, unknown>,
        documentMetadata.metadata,
      ),
      pages,
      quality: {
        status: qualityStatus,
        pagesExtracted,
        pagesRequiringOcr,
        emptyPages,
        warnings,
      },
      extractor: {
        provider: "pdfjs",
        version: pdfjsVersion,
        processedAt: new Date().toISOString(),
        durationMs: Math.round(performance.now() - startedAt),
      },
    };
    return extractedDocumentSchema.parse(result);
  } catch (error) {
    throw normalizePdfError(error);
  } finally {
    await loadingTask.destroy();
  }
}
