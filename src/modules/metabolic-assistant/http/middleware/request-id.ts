import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export function attachRequestId(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const incomingRequestId = request.header("x-request-id")?.trim();
  const requestId = incomingRequestId || randomUUID();

  response.locals.requestId = requestId;
  response.setHeader("x-request-id", requestId);
  next();
}
