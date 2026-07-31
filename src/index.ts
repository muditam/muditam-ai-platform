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
  STRUCTURED_REPORT_SCHEMA_VERSION,
  observationSchema,
  structuredReportSchema,
  type Observation,
  type StructuredReport,
} from "./contracts/structured-report.js";
export {
  NORMALIZED_REPORT_SCHEMA_VERSION,
  normalizedObservationSchema,
  normalizedReportSchema,
  type NormalizedObservation,
  type NormalizedReport,
} from "./contracts/normalized-report.js";
export {
  BIOMARKER_CATALOGUE_VERSION,
  biomarkerCatalogue,
  findBiomarker,
  normalizeBiomarkerName,
  type BiomarkerDefinition,
} from "./catalogue/biomarkers.js";
export {
  resolveBiomarker,
  type BiomarkerResolution,
  type MappingMethod,
  type MappingStatus,
  type ResolveBiomarkerInput,
} from "./catalogue/biomarker-resolver.js";
export {
  ExtractionError,
  type ExtractionErrorCode,
} from "./errors/extraction-error.js";
export { extractPdf, type ExtractPdfOptions } from "./pdf/extract-pdf.js";
export {
  renderPdfPages,
  type RenderedPdfPage,
} from "./pdf/render-pdf-pages.js";
export {
  extractImageReport,
  OpenAIImageObservationExtractor,
  type ExtractImageInput,
  type ImageObservationExtractor,
  type OpenAIImageExtractorOptions,
  type SupportedImageMimeType,
} from "./image/image-report-extractor.js";
export { normalizeReport } from "./report/normalize-report.js";
export { mergeStructuredReports } from "./report/merge-structured-reports.js";
export { structureReport } from "./report/structure-report.js";
export {
  detectColumnModel,
  nearestColumn,
  type ColumnAnchors,
  type ColumnModel,
} from "./report/column-model.js";
export {
  verifyGoldenReport,
  type GoldenCheck,
  type GoldenObservation,
  type GoldenReport,
  type GoldenVerification,
} from "./report/verify-golden-report.js";
