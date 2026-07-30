import { describe, expect, it, vi } from "vitest";
import type { ReportExtractor } from "../../src/modules/metabolic-assistant/adapters/extraction/report-extractor.js";
import type { ReadableReportStorage } from "../../src/modules/metabolic-assistant/adapters/storage/report-storage.js";
import type { CanonicalExtractionResult } from "../../src/modules/metabolic-assistant/contracts/extraction.js";
import { MetabolicAssistantError } from "../../src/modules/metabolic-assistant/contracts/errors.js";
import type { MetabolicLogger } from "../../src/modules/metabolic-assistant/observability/logger.js";
import type {
  ProcessingJobRepositoryPort,
} from "../../src/modules/metabolic-assistant/repositories/processing-job-repository.js";
import type {
  ExtractionReportRepositoryPort,
  ReportRecord,
} from "../../src/modules/metabolic-assistant/repositories/report-repository.js";
import { ExtractionWorker } from "../../src/modules/metabolic-assistant/workers/extraction-worker.js";

const report: ReportRecord = {
  id: "507f1f77bcf86cd799439011",
  displayName: "Report",
  status: "QUEUED",
  file: {
    originalName: "report.pdf",
    mimeType: "application/pdf",
    byteSize: 20,
    sha256: "a".repeat(64),
    storageProvider: "local",
    objectKey: "private-report.pdf",
  },
  extraction: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const extraction: CanonicalExtractionResult = {
  schemaVersion: "1.0.0",
  reportId: report.id,
  provider: {
    kind: "test",
    name: "fixture",
    version: "1",
  },
  source: {
    fileName: "report.pdf",
    mimeType: "application/pdf",
    sha256: "a".repeat(64),
  },
  biomarkers: [
    {
      id: "hba1c-1",
      canonicalCode: "hba1c",
      panel: "GLYCEMIC",
      sourceLabel: "HbA1c",
      numericValue: 6.2,
      unit: "%",
      status: "HIGH",
      confidence: 0.98,
      reviewState: "UNREVIEWED",
    },
  ],
  warnings: [],
  extractedAt: "2026-07-30T00:00:00.000Z",
};

describe("extraction worker", () => {
  it("leases, extracts, validates, persists, and completes one job", async () => {
    const jobs: ProcessingJobRepositoryPort = {
      leaseNext: vi.fn().mockResolvedValue({
        id: "507f1f77bcf86cd799439012",
        reportId: report.id,
        attempts: 1,
      }),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn(),
    };
    const reports: ExtractionReportRepositoryPort = {
      getById: vi.fn().mockResolvedValue(report),
      markProcessing: vi.fn().mockResolvedValue(undefined),
      saveExtraction: vi.fn().mockResolvedValue(undefined),
      markQueuedForRetry: vi.fn(),
      markFailed: vi.fn(),
    };
    const storage = {
      read: vi.fn().mockResolvedValue(new TextEncoder().encode("%PDF-1.7")),
    } as unknown as ReadableReportStorage;
    const extractor: ReportExtractor = {
      providerKind: "test",
      extract: vi.fn().mockResolvedValue(extraction),
    };
    const logger: MetabolicLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const worker = new ExtractionWorker({
      jobs,
      reports,
      storage,
      extractor,
      logger,
      leaseMs: 60_000,
      maxAttempts: 3,
    });

    await expect(worker.runOnce()).resolves.toBe(true);
    expect(reports.markProcessing).toHaveBeenCalledWith(report.id);
    expect(extractor.extract).toHaveBeenCalledOnce();
    expect(reports.saveExtraction).toHaveBeenCalledWith(
      report.id,
      extraction,
    );
    expect(jobs.complete).toHaveBeenCalledOnce();
    expect(jobs.fail).not.toHaveBeenCalled();
  });

  it("does not retry a file that is not a blood report", async () => {
    const jobs: ProcessingJobRepositoryPort = {
      leaseNext: vi.fn().mockResolvedValue({
        id: "507f1f77bcf86cd799439012",
        reportId: report.id,
        attempts: 1,
      }),
      complete: vi.fn(),
      fail: vi.fn().mockResolvedValue({ terminal: true }),
    };
    const reports: ExtractionReportRepositoryPort = {
      getById: vi.fn().mockResolvedValue(report),
      markProcessing: vi.fn().mockResolvedValue(undefined),
      saveExtraction: vi.fn(),
      markQueuedForRetry: vi.fn(),
      markFailed: vi.fn().mockResolvedValue(undefined),
    };
    const storage = {
      read: vi.fn().mockResolvedValue(new TextEncoder().encode("%PDF-1.7")),
    } as unknown as ReadableReportStorage;
    const extractor: ReportExtractor = {
      providerKind: "test",
      extract: vi.fn().mockRejectedValue(
        new MetabolicAssistantError(
          "NOT_A_BLOOD_REPORT",
          "The file is not a blood report.",
        ),
      ),
    };
    const logger: MetabolicLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const worker = new ExtractionWorker({
      jobs,
      reports,
      storage,
      extractor,
      logger,
      leaseMs: 60_000,
      maxAttempts: 3,
    });

    await expect(worker.runOnce()).resolves.toBe(true);
    expect(jobs.fail).toHaveBeenCalledWith(
      "507f1f77bcf86cd799439012",
      3,
      3,
      "NOT_A_BLOOD_REPORT",
      expect.any(Date),
    );
    expect(reports.markFailed).toHaveBeenCalledWith(
      report.id,
      "NOT_A_BLOOD_REPORT",
      "The file is not a blood report.",
    );
    expect(reports.markQueuedForRetry).not.toHaveBeenCalled();
  });
});
