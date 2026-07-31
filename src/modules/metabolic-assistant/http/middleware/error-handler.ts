import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { MetabolicAssistantError } from "../../contracts/errors.js";
import type { MetabolicLogger } from "../../observability/logger.js";

export function createMetabolicErrorHandler(logger: MetabolicLogger) {
  return (
    error: unknown,
    _request: Request,
    response: Response,
    _next: NextFunction,
  ): void => {
    const requestId = String(response.locals.requestId ?? "unknown");
    const normalized = error instanceof multer.MulterError
      ? new MetabolicAssistantError(
          error.code === "LIMIT_FILE_SIZE" ? "FILE_TOO_LARGE" : "INVALID_FILE",
          error.code === "LIMIT_FILE_SIZE"
            ? "The uploaded report exceeds the configured size limit."
            : "The multipart report upload is invalid.",
          { status: error.code === "LIMIT_FILE_SIZE" ? 413 : 400, cause: error },
        )
      : error instanceof MetabolicAssistantError
        ? error
        : new MetabolicAssistantError(
            "INTERNAL_ERROR",
            "An unexpected error occurred.",
            { cause: error },
          );

    logger.error("Request failed.", {
      requestId,
      code: normalized.code,
      status: normalized.status,
    });

    response.status(normalized.status).json({
      ok: false,
      data: null,
      error: {
        code: normalized.code,
        message: normalized.message,
        ...(normalized.details === undefined
          ? {}
          : { details: normalized.details }),
      },
      requestId,
    });
  };
}
