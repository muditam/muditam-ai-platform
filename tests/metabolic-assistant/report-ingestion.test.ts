import { describe, expect, it } from "vitest";
import type {
  ReportStorage,
  StoreReportFileInput,
} from "../../src/modules/metabolic-assistant/adapters/storage/report-storage.js";
import type {
  CreateQueuedReportRecord,
  ReportRecord,
  ReportRepositoryPort,
} from "../../src/modules/metabolic-assistant/repositories/report-repository.js";
import type { ReportUsageRepositoryPort } from "../../src/modules/metabolic-assistant/repositories/report-usage-repository.js";
import { ReportIngestionService } from "../../src/modules/metabolic-assistant/services/report-ingestion-service.js";

class FakeReportRepository implements ReportRepositoryPort {
  created?: CreateQueuedReportRecord;

  createId(): string {
    return "507f1f77bcf86cd799439011";
  }

  async createQueued(input: CreateQueuedReportRecord): Promise<ReportRecord> {
    this.created = input;
    return {
      id: input.reportId,
      ...(input.subjectId === undefined ? {} : { subjectId: input.subjectId }),
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
      createdAt: new Date("2026-07-30T00:00:00.000Z"),
      updatedAt: new Date("2026-07-30T00:00:00.000Z"),
    };
  }

  async getById(): Promise<ReportRecord> {
    throw new Error("Not required by this test.");
  }

  async countBySubjectId(): Promise<number> {
    return 0;
  }

  async list(): Promise<ReportRecord[]> {
    return [];
  }

  async deleteById(): Promise<ReportRecord> {
    throw new Error("Not required by this test.");
  }
}

class FakeReportStorage implements ReportStorage {
  stored?: StoreReportFileInput;

  async store(input: StoreReportFileInput) {
    this.stored = input;
    return {
      storageProvider: "local" as const,
      objectKey: "private/report.pdf",
      byteSize: input.bytes.byteLength,
    };
  }

  async delete(): Promise<void> {}
}

class FakeReportUsage implements ReportUsageRepositoryPort {
  released?: string;

  constructor(private readonly accepted = true) {}

  async reserve() {
    return {
      accepted: this.accepted,
      remaining: this.accepted ? 1 : 0,
    };
  }

  async release(subjectId: string): Promise<void> {
    this.released = subjectId;
  }
}

describe("report ingestion service", () => {
  it("stores and queues a valid PDF without selecting an extractor", async () => {
    const repository = new FakeReportRepository();
    const storage = new FakeReportStorage();
    const service = new ReportIngestionService(repository, storage);

    const result = await service.upload({
      originalName: "blood-report.pdf",
      declaredMimeType: "application/pdf",
      bytes: new TextEncoder().encode("%PDF-1.7 synthetic"),
      displayName: "July report",
      subjectId: "test-subject",
    });

    expect(result.report.status).toBe("QUEUED");
    expect(result.report.extraction).toBeNull();
    expect(storage.stored?.originalName).toBe("blood-report.pdf");
    expect(repository.created?.subjectId).toBe("test-subject");
  });

  it("rejects a declared PDF whose bytes are not a PDF", async () => {
    const service = new ReportIngestionService(
      new FakeReportRepository(),
      new FakeReportStorage(),
    );

    await expect(
      service.upload({
        originalName: "fake.pdf",
        declaredMimeType: "application/pdf",
        bytes: new TextEncoder().encode("not a pdf"),
      }),
    ).rejects.toMatchObject({ code: "INVALID_FILE", status: 400 });
  });

  it("requires subjectId when the per-user upload limit is enabled", async () => {
    const service = new ReportIngestionService(
      new FakeReportRepository(),
      new FakeReportStorage(),
      {
        usage: new FakeReportUsage(),
        maximum: 2,
        requireSubjectId: true,
      },
    );

    await expect(
      service.upload({
        originalName: "blood-report.pdf",
        declaredMimeType: "application/pdf",
        bytes: new TextEncoder().encode("%PDF-1.7 synthetic"),
      }),
    ).rejects.toMatchObject({ code: "SUBJECT_ID_REQUIRED", status: 400 });
  });

  it("stops before file storage when the user's total report limit is reached", async () => {
    const storage = new FakeReportStorage();
    const service = new ReportIngestionService(
      new FakeReportRepository(),
      storage,
      {
        usage: new FakeReportUsage(false),
        maximum: 2,
        requireSubjectId: true,
      },
    );

    await expect(
      service.upload({
        originalName: "blood-report.pdf",
        declaredMimeType: "application/pdf",
        bytes: new TextEncoder().encode("%PDF-1.7 synthetic"),
        subjectId: "test-user",
      }),
    ).rejects.toMatchObject({ code: "REPORT_LIMIT_REACHED", status: 429 });
    expect(storage.stored).toBeUndefined();
  });
});
