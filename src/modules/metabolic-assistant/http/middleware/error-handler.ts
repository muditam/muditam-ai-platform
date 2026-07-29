import type { NextFunction, Request, Response } from "express";
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
    const normalized =
      error instanceof MetabolicAssistantError
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
      },
      requestId,
    });
  };
}
