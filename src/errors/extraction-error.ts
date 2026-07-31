export type ExtractionErrorCode =
  | "INVALID_PDF"
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "OCR_REQUIRED"
  | "UNSUPPORTED_DOCUMENT_TYPE"
  | "INVALID_IMAGE"
  | "INVALID_CONFIGURATION"
  | "NOT_A_BLOOD_REPORT"
  | "VISION_INVALID_OUTPUT"
  | "VISION_PROVIDER_ERROR"
  | "PAGE_LIMIT_EXCEEDED"
  | "PASSWORD_PROTECTED"
  | "PDF_PARSE_FAILED";

export class ExtractionError extends Error {
  readonly code: ExtractionErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: ExtractionErrorCode,
    message: string,
    details?: Record<string, unknown>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ExtractionError";
    this.code = code;
    this.details = details;
  }
}
