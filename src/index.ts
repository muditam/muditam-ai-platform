export {
  EXTRACTION_SCHEMA_VERSION,
  extractedDocumentSchema,
  type BoundingBox,
  type ExtractedDocument,
  type ExtractedPage,
  type ExtractionWarning,
  type PositionedTextItem,
  type TextLine,
} from "./contracts/extracted-document.js";
export {
  ExtractionError,
  type ExtractionErrorCode,
} from "./errors/extraction-error.js";
export { extractPdf, type ExtractPdfOptions } from "./pdf/extract-pdf.js";
