import type { NextFunction, Request, Response } from "express";
import { MetabolicAssistantError } from "../../contracts/errors.js";
import type {
  ReportOperations,
  UploadReportInput,
} from "../../services/report-ingestion-service.js";

function textField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export class ReportController {
  constructor(private readonly reports: ReportOperations) {}

  upload = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (request.file === undefined) {
        throw new MetabolicAssistantError(
          "INVALID_FILE",
          'A multipart file field named "report" is required.',
          { status: 400 },
        );
      }
      const uploadInput: UploadReportInput = {
        originalName: request.file.originalname,
        declaredMimeType: request.file.mimetype,
        bytes: request.file.buffer,
      };
      const displayName = textField(request.body.displayName);
      const subjectId = textField(request.body.subjectId);
      if (displayName !== undefined) uploadInput.displayName = displayName;
      if (subjectId !== undefined) uploadInput.subjectId = subjectId;
      const result = await this.reports.upload(uploadInput);
      response.status(202).json({
        ok: true,
        data: result,
        error: null,
        requestId: String(response.locals.requestId),
      });
    } catch (error) {
      next(error);
    }
  };

  list = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const reports = await this.reports.list(textField(request.query.subjectId));
      response.json({
        ok: true,
        data: { reports },
        error: null,
        requestId: String(response.locals.requestId),
      });
    } catch (error) {
      next(error);
    }
  };

  get = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const report = await this.reports.get(String(request.params.reportId));
      response.json({
        ok: true,
        data: { report },
        error: null,
        requestId: String(response.locals.requestId),
      });
    } catch (error) {
      next(error);
    }
  };

  delete = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      await this.reports.delete(String(request.params.reportId));
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  };
}
