import { Types, type Model } from "mongoose";
import type { MetabolicProcessingJobDocument } from "../database/models/metabolic-processing-job.js";
import type { MetabolicReportDocument } from "../database/models/metabolic-report.js";
import { MetabolicAssistantError } from "../contracts/errors.js";
import type { SupportedReportMimeType } from "../adapters/extraction/report-extractor.js";
import type { CanonicalExtractionResult } from "../contracts/extraction.js";

export interface CreateQueuedReportRecord {
  reportId: string;
  subjectId?: string;
  displayName: string;
  originalName: string;
  mimeType: SupportedReportMimeType;
  byteSize: number;
  sha256: string;
  storageProvider: "local" | "s3";
  objectKey: string;
}

export interface ReportRecord {
  id: string;
  subjectId?: string;
  displayName: string;
  status: string;
  file: {
    originalName: string;
    mimeType: SupportedReportMimeType;
    byteSize: number;
    sha256: string;
    storageProvider: "local" | "s3";
    objectKey: string;
  };
  extraction: unknown;
  failure?: {
    code: string;
    message: string;
    failedAt: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface ReportRepositoryPort {
  createId(): string;
  createQueued(input: CreateQueuedReportRecord): Promise<ReportRecord>;
  getById(id: string): Promise<ReportRecord>;
  list(subjectId?: string): Promise<ReportRecord[]>;
  deleteById(id: string): Promise<ReportRecord>;
}

export interface ExtractionReportRepositoryPort {
  getById(id: string): Promise<ReportRecord>;
  markProcessing(id: string): Promise<void>;
  saveExtraction(
    id: string,
    extraction: CanonicalExtractionResult,
  ): Promise<void>;
  markQueuedForRetry(id: string): Promise<void>;
  markFailed(id: string, code: string, message: string): Promise<void>;
}

function assertObjectId(id: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) {
    throw new MetabolicAssistantError("REPORT_NOT_FOUND", "Report not found.", {
      status: 404,
    });
  }
  return new Types.ObjectId(id);
}

function toRecord(value: Record<string, unknown>): ReportRecord {
  const file = value.file as ReportRecord["file"];
  const record: ReportRecord = {
    id: String(value._id),
    displayName: String(value.displayName),
    status: String(value.status),
    file,
    extraction: value.extraction ?? null,
    createdAt: value.createdAt as Date,
    updatedAt: value.updatedAt as Date,
  };
  if (typeof value.subjectId === "string") record.subjectId = value.subjectId;
  if (typeof value.failure === "object" && value.failure !== null) {
    const failure = value.failure as Record<string, unknown>;
    if (
      typeof failure.code === "string" &&
      typeof failure.message === "string" &&
      failure.failedAt instanceof Date
    ) {
      record.failure = {
        code: failure.code,
        message: failure.message,
        failedAt: failure.failedAt,
      };
    }
  }
  return record;
}

export class ReportRepository implements ReportRepositoryPort {
  constructor(
    private readonly reportModel: Model<MetabolicReportDocument>,
    private readonly jobModel: Model<MetabolicProcessingJobDocument>,
  ) {}

  createId(): string {
    return new Types.ObjectId().toHexString();
  }

  async createQueued(input: CreateQueuedReportRecord): Promise<ReportRecord> {
    const reportObjectId = assertObjectId(input.reportId);
    const reportPayload: Record<string, unknown> = {
      _id: reportObjectId,
      displayName: input.displayName,
      status: "QUEUED",
      file: {
        originalName: input.originalName,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        sha256: input.sha256,
        storageProvider: input.storageProvider,
        objectKey: input.objectKey,
      },
      extraction: null,
    };
    if (input.subjectId !== undefined) reportPayload.subjectId = input.subjectId;

    const report = await this.reportModel.create(reportPayload);
    try {
      await this.jobModel.create({
        reportId: reportObjectId,
        type: "extract_report",
        status: "queued",
        attempts: 0,
        availableAt: new Date(),
      });
    } catch (error) {
      await this.reportModel.deleteOne({ _id: reportObjectId });
      throw error;
    }

    return toRecord(report.toObject() as unknown as Record<string, unknown>);
  }

  async getById(id: string): Promise<ReportRecord> {
    const report = await this.reportModel
      .findById(assertObjectId(id))
      .lean()
      .exec();
    if (report === null) {
      throw new MetabolicAssistantError(
        "REPORT_NOT_FOUND",
        "Report not found.",
        { status: 404 },
      );
    }
    return toRecord(report as unknown as Record<string, unknown>);
  }

  async list(subjectId?: string): Promise<ReportRecord[]> {
    const filter = subjectId === undefined ? {} : { subjectId };
    const reports = await this.reportModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean()
      .exec();
    return reports.map((report) =>
      toRecord(report as unknown as Record<string, unknown>),
    );
  }

  async deleteById(id: string): Promise<ReportRecord> {
    const objectId = assertObjectId(id);
    const report = await this.reportModel.findByIdAndDelete(objectId).lean().exec();
    if (report === null) {
      throw new MetabolicAssistantError(
        "REPORT_NOT_FOUND",
        "Report not found.",
        { status: 404 },
      );
    }
    await this.jobModel.deleteMany({ reportId: objectId });
    return toRecord(report as unknown as Record<string, unknown>);
  }

  async markProcessing(id: string): Promise<void> {
    await this.updateReport(id, {
      $set: { status: "PROCESSING" },
      $unset: { failure: 1 },
    });
  }

  async saveExtraction(
    id: string,
    extraction: CanonicalExtractionResult,
  ): Promise<void> {
    await this.updateReport(id, {
      $set: {
        status: "NEEDS_REVIEW",
        extraction,
      },
      $unset: { failure: 1 },
    });
  }

  async markQueuedForRetry(id: string): Promise<void> {
    await this.updateReport(id, {
      $set: { status: "QUEUED" },
    });
  }

  async markFailed(
    id: string,
    code: string,
    message: string,
  ): Promise<void> {
    await this.updateReport(id, {
      $set: {
        status: "FAILED",
        failure: {
          code,
          message,
          failedAt: new Date(),
        },
      },
    });
  }

  private async updateReport(
    id: string,
    update: Record<string, unknown>,
  ): Promise<void> {
    const result = await this.reportModel
      .updateOne({ _id: assertObjectId(id) }, update)
      .exec();
    if (result.matchedCount === 0) {
      throw new MetabolicAssistantError(
        "REPORT_NOT_FOUND",
        "Report not found.",
        { status: 404 },
      );
    }
  }
}
