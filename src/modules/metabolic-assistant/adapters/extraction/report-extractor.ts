import type { CanonicalExtractionResult } from "../../contracts/extraction.js";

export type SupportedReportMimeType =
  | "application/pdf"
  | "image/jpeg"
  | "image/png";

export interface ReportExtractionInput {
  reportId: string;
  fileName: string;
  mimeType: SupportedReportMimeType;
  sha256: string;
  bytes: Uint8Array;
}

/**
 * Provider-neutral extraction port.
 *
 * OpenAI, OCR, manual, and test implementations must all implement this exact
 * interface and return the canonical extraction contract. Downstream code must
 * depend on this port, never on a provider SDK response.
 */
export interface ReportExtractor {
  readonly providerKind: "openai" | "ocr" | "manual" | "test";
  extract(input: ReportExtractionInput): Promise<CanonicalExtractionResult>;
}
