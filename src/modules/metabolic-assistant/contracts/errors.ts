export type MetabolicErrorCode =
  | "FEATURE_DISABLED"
  | "INVALID_CONFIGURATION"
  | "NOT_FOUND"
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
