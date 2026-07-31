export type MetabolicErrorCode =
  | "FEATURE_DISABLED"
  | "FILE_TOO_LARGE"
  | "INVALID_FILE"
  | "INVALID_CONFIGURATION"
  | "NOT_FOUND"
  | "REPORT_NOT_FOUND"
  | "SUBJECT_ID_REQUIRED"
  | "REPORT_LIMIT_REACHED"
  | "STORAGE_ERROR"
  | "EXTRACTION_PROVIDER_ERROR"
  | "EXTRACTION_INVALID_OUTPUT"
  | "NOT_A_BLOOD_REPORT"
  | "CHAT_DISABLED"
  | "CHAT_REPORT_NOT_READY"
  | "CHAT_CONVERSATION_NOT_FOUND"
  | "CHAT_RATE_LIMITED"
  | "CHAT_REPORT_LIMIT_EXCEEDED"
  | "INVALID_CHAT_QUESTION"
  | "CHAT_PROVIDER_ERROR"
  | "INTERNAL_ERROR";

export class MetabolicAssistantError extends Error {
  readonly code: MetabolicErrorCode;
  readonly status: number;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: MetabolicErrorCode,
    message: string,
    options: {
      status?: number;
      details?: Readonly<Record<string, unknown>>;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "MetabolicAssistantError";
    this.code = code;
    this.status = options.status ?? 500;
    if (options.details !== undefined) this.details = options.details;
  }
}
