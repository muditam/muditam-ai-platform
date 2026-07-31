import { createHash } from "node:crypto";
import type { SupportedReportMimeType } from "../adapters/extraction/report-extractor.js";
import type { ReportStorage } from "../adapters/storage/report-storage.js";
import { MetabolicAssistantError } from "../contracts/errors.js";
import {
  type CreateQueuedReportRecord,
  type ReportRecord,
  type ReportRepositoryPort,
} from "../repositories/report-repository.js";
import type { ReportUsageRepositoryPort } from "../repositories/report-usage-repository.js";

export interface UploadReportInput {
  originalName: string;
  declaredMimeType: string;
  bytes: Uint8Array;
  displayName?: string;
  subjectId?: string;
}

export interface PublicReport {
  id: string;
  subjectId?: string;
  displayName: string;
  status: string;
  file: {
    originalName: string;
    mimeType: string;
    byteSize: number;
    sha256: string;
  };
  extraction: unknown;
  failure?: {
    code: string;
    message: string;
    failedAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface UploadReportResult {
  report: PublicReport;
  quota?: {
    maximum: number;
    remaining: number;
  };
}

export interface ReportOperations {
  upload(input: UploadReportInput): Promise<UploadReportResult>;
  get(id: string): Promise<PublicReport>;
  list(subjectId?: string): Promise<PublicReport[]>;
  delete(id: string): Promise<void>;
}

const supportedMimeTypes = new Set<SupportedReportMimeType>([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

function isPdf(bytes: Uint8Array): boolean {
  return new TextDecoder("latin1")
    .decode(bytes.subarray(0, Math.min(bytes.length, 1024)))
    .includes("%PDF-");
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isPng(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return signature.every((value, index) => bytes[index] === value);
}

function validateFileSignature(
  mimeType: SupportedReportMimeType,
  bytes: Uint8Array,
): void {
  const valid =
    (mimeType === "application/pdf" && isPdf(bytes)) ||
    (mimeType === "image/jpeg" && isJpeg(bytes)) ||
    (mimeType === "image/png" && isPng(bytes));
  if (!valid) {
    throw new MetabolicAssistantError(
      "INVALID_FILE",
      "The uploaded file content does not match its declared type.",
      { status: 400 },
    );
  }
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function toPublicReport(record: ReportRecord): PublicReport {
  const report: PublicReport = {
    id: record.id,
    displayName: record.displayName,
    status: record.status,
    file: {
      originalName: record.file.originalName,
      mimeType: record.file.mimeType,
      byteSize: record.file.byteSize,
      sha256: record.file.sha256,
    },
    extraction: record.extraction,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
  if (record.subjectId !== undefined) report.subjectId = record.subjectId;
  if (record.failure !== undefined) {
    report.failure = {
      code: record.failure.code,
      message: record.failure.message,
      failedAt: record.failure.failedAt.toISOString(),
    };
  }
  return report;
}

export class ReportIngestionService implements ReportOperations {
  constructor(
    private readonly repository: ReportRepositoryPort,
    private readonly storage: ReportStorage,
    private readonly quota?: {
      usage: ReportUsageRepositoryPort;
      maximum: number;
      requireSubjectId: boolean;
    },
  ) {}

  async upload(input: UploadReportInput): Promise<UploadReportResult> {
    if (input.bytes.byteLength === 0) {
      throw new MetabolicAssistantError(
        "INVALID_FILE",
        "A non-empty report file is required.",
        { status: 400 },
      );
    }
    if (!supportedMimeTypes.has(input.declaredMimeType as SupportedReportMimeType)) {
      throw new MetabolicAssistantError(
        "INVALID_FILE",
        "Only PDF, JPEG, and PNG reports are supported.",
        { status: 400 },
      );
    }

    const mimeType = input.declaredMimeType as SupportedReportMimeType;
    validateFileSignature(mimeType, input.bytes);
    const subjectId = normalizeOptionalText(input.subjectId);
    if (this.quota?.requireSubjectId === true && subjectId === undefined) {
      throw new MetabolicAssistantError(
        "SUBJECT_ID_REQUIRED",
        "subjectId is required for report upload limits.",
        { status: 400 },
      );
    }

    let quotaResult: { maximum: number; remaining: number } | undefined;
    let quotaReserved = false;
    if (this.quota !== undefined && subjectId !== undefined) {
      const reservation = await this.quota.usage.reserve({
        subjectId,
        existingReportCount:
          await this.repository.countBySubjectId(subjectId),
        maximum: this.quota.maximum,
      });
      if (!reservation.accepted) {
        throw new MetabolicAssistantError(
          "REPORT_LIMIT_REACHED",
          "This user has reached the total report upload limit.",
          {
            status: 429,
            details: { maximum: this.quota.maximum, remaining: 0 },
          },
        );
      }
      quotaReserved = true;
      quotaResult = {
        maximum: this.quota.maximum,
        remaining: reservation.remaining,
      };
    }

    const reportId = this.repository.createId();
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    let stored:
      | Awaited<ReturnType<ReportStorage["store"]>>
      | undefined;

    try {
      stored = await this.storage.store({
        reportId,
        originalName: input.originalName,
        mimeType,
        sha256,
        bytes: input.bytes,
      });
      const createInput: CreateQueuedReportRecord = {
        reportId,
        displayName:
          normalizeOptionalText(input.displayName) ?? input.originalName,
        originalName: input.originalName,
        mimeType,
        byteSize: stored.byteSize,
        sha256,
        storageProvider: stored.storageProvider,
        objectKey: stored.objectKey,
      };
      if (subjectId !== undefined) createInput.subjectId = subjectId;
      const result: UploadReportResult = {
        report: toPublicReport(
          await this.repository.createQueued(createInput),
        ),
      };
      if (quotaResult !== undefined) result.quota = quotaResult;
      return result;
    } catch (error) {
      if (stored !== undefined) {
        await this.storage.delete(stored.objectKey).catch(() => undefined);
      }
      if (quotaReserved && subjectId !== undefined && this.quota !== undefined) {
        await this.quota.usage.release(subjectId).catch(() => undefined);
      }
      throw error;
    }
  }

  async get(id: string): Promise<PublicReport> {
    return toPublicReport(await this.repository.getById(id));
  }

  async list(subjectId?: string): Promise<PublicReport[]> {
    return (await this.repository.list(normalizeOptionalText(subjectId))).map(
      toPublicReport,
    );
  }

  async delete(id: string): Promise<void> {
    const report = await this.repository.deleteById(id);
    if (report.subjectId !== undefined && this.quota !== undefined) {
      await this.quota.usage.release(report.subjectId);
    }
    await this.storage.delete(report.file.objectKey);
  }
}
