import { z } from "zod";

export const EXTRACTION_SCHEMA_VERSION = "1.0.0" as const;

export const boundingBoxSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
});

export const textItemSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  boundingBox: boundingBoxSchema,
  baselineY: z.number().finite(),
  fontName: z.string().optional(),
  fontSize: z.number().finite().nonnegative(),
  direction: z.enum(["ltr", "rtl", "ttb"]),
  hasEndOfLine: z.boolean(),
});

export const textLineSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  itemIds: z.array(z.string().min(1)).min(1),
  boundingBox: boundingBoxSchema,
});

export const extractionWarningSchema = z.object({
  code: z.enum([
    "NO_TEXT",
    "LOW_TEXT_CONTENT",
    "CORRUPTED_GLYPHS",
    "IMAGE_ONLY_PAGE",
    "MIXED_EXTRACTION_QUALITY",
  ]),
  message: z.string().min(1),
  pageNumber: z.number().int().positive().optional(),
});

export const extractedPageSchema = z.object({
  pageNumber: z.number().int().positive(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  rotation: z.number().finite(),
  extractionMethod: z.literal("PDF_TEXT"),
  items: z.array(textItemSchema),
  lines: z.array(textLineSchema),
  plainText: z.string(),
  quality: z.object({
    status: z.enum(["GOOD", "SUSPECT", "OCR_REQUIRED", "EMPTY"]),
    textCharacters: z.number().int().nonnegative(),
    alphanumericCharacters: z.number().int().nonnegative(),
    numericTokens: z.number().int().nonnegative(),
    replacementCharacters: z.number().int().nonnegative(),
    imageObjects: z.number().int().nonnegative(),
    warnings: z.array(extractionWarningSchema),
  }),
});

export const extractedDocumentSchema = z.object({
  schemaVersion: z.literal(EXTRACTION_SCHEMA_VERSION),
  documentId: z.string().min(1),
  source: z.object({
    fileName: z.string().min(1),
    mimeType: z.literal("application/pdf"),
    byteSize: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  metadata: z.object({
    title: z.string().optional(),
    author: z.string().optional(),
    subject: z.string().optional(),
    creator: z.string().optional(),
    producer: z.string().optional(),
    creationDate: z.string().optional(),
    modificationDate: z.string().optional(),
    language: z.string().optional(),
  }),
  pages: z.array(extractedPageSchema).min(1),
  quality: z.object({
    status: z.enum(["EXTRACTED", "PARTIAL", "OCR_REQUIRED"]),
    pagesExtracted: z.number().int().nonnegative(),
    pagesRequiringOcr: z.array(z.number().int().positive()),
    emptyPages: z.array(z.number().int().positive()),
    warnings: z.array(extractionWarningSchema),
  }),
  extractor: z.object({
    provider: z.literal("pdfjs"),
    version: z.string().min(1),
    processedAt: z.string().datetime(),
    durationMs: z.number().int().nonnegative(),
  }),
});

export type BoundingBox = z.infer<typeof boundingBoxSchema>;
export type PositionedTextItem = z.infer<typeof textItemSchema>;
export type TextLine = z.infer<typeof textLineSchema>;
export type ExtractionWarning = z.infer<typeof extractionWarningSchema>;
export type ExtractedPage = z.infer<typeof extractedPageSchema>;
export type ExtractedDocument = z.infer<typeof extractedDocumentSchema>;
