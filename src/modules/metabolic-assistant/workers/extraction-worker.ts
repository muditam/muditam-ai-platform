import type { ReportExtractor } from "../adapters/extraction/report-extractor.js";
import type { ReadableReportStorage } from "../adapters/storage/report-storage.js";
import { canonicalExtractionResultSchema } from "../contracts/extraction.js";
import { MetabolicAssistantError } from "../contracts/errors.js";
import type { MetabolicLogger } from "../observability/logger.js";
import type {
  ProcessingJobRepositoryPort,
} from "../repositories/processing-job-repository.js";
import type {
  ExtractionReportRepositoryPort,
} from "../repositories/report-repository.js";

export interface ExtractionWorkerOptions {
  jobs: ProcessingJobRepositoryPort;
  reports: ExtractionReportRepositoryPort;
  storage: ReadableReportStorage;
  extractor: ReportExtractor;
  logger: MetabolicLogger;
  leaseMs: number;
  maxAttempts: number;
  now?: () => Date;
}

function safeErrorCode(error: unknown): string {
  return error instanceof MetabolicAssistantError
    ? error.code
    : "EXTRACTION_FAILED";
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof MetabolicAssistantError) return error.message;
  return "Report extraction failed.";
}

export class ExtractionWorker {
  readonly #now: () => Date;

  constructor(private readonly options: ExtractionWorkerOptions) {
    this.#now = options.now ?? (() => new Date());
  }

  async runOnce(): Promise<boolean> {
    const lease = await this.options.jobs.leaseNext(
      this.#now(),
      this.options.leaseMs,
    );
    if (lease === null) return false;

    try {
      const report = await this.options.reports.getById(lease.reportId);
      if (report.extraction !== null) {
        canonicalExtractionResultSchema.parse(report.extraction);
        await this.options.jobs.complete(lease.id);
        return true;
      }

      await this.options.reports.markProcessing(report.id);
      const bytes = await this.options.storage.read(report.file.objectKey);
      const extraction = await this.options.extractor.extract({
        reportId: report.id,
        fileName: report.file.originalName,
        mimeType: report.file.mimeType,
        sha256: report.file.sha256,
        bytes,
      });
      const validated = canonicalExtractionResultSchema.parse(extraction);
      await this.options.reports.saveExtraction(report.id, validated);
      await this.options.jobs.complete(lease.id);
      this.options.logger.info("Report extraction completed.", {
        reportId: report.id,
        provider: validated.provider.kind,
        biomarkerCount: validated.biomarkers.length,
      });
    } catch (error) {
      const code = safeErrorCode(error);
      const message = safeErrorMessage(error);
      const retryDelayMs = Math.min(60_000, 2 ** lease.attempts * 1_000);
      const attemptsForFailure =
        code === "NOT_A_BLOOD_REPORT"
          ? this.options.maxAttempts
          : lease.attempts;
      const failure = await this.options.jobs.fail(
        lease.id,
        attemptsForFailure,
        this.options.maxAttempts,
        code,
        new Date(this.#now().getTime() + retryDelayMs),
      );
      if (failure.terminal) {
        await this.options.reports.markFailed(lease.reportId, code, message);
      } else {
        await this.options.reports.markQueuedForRetry(lease.reportId);
      }
      this.options.logger.error("Report extraction attempt failed.", {
        reportId: lease.reportId,
        attempt: lease.attempts,
        terminal: failure.terminal,
        code,
      });
    }
    return true;
  }
}

export class ExtractionWorkerRunner {
  #timer: NodeJS.Timeout | undefined;
  #active: Promise<void> | undefined;
  #stopped = true;

  constructor(
    private readonly worker: ExtractionWorker,
    private readonly pollIntervalMs: number,
    private readonly concurrency: number,
    private readonly logger: MetabolicLogger,
  ) {}

  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#schedule(0);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    await this.#active;
  }

  #schedule(delayMs: number): void {
    if (this.#stopped) return;
    this.#timer = setTimeout(() => {
      this.#active = this.#tick();
    }, delayMs);
  }

  async #tick(): Promise<void> {
    let processedAny = false;
    try {
      const results = await Promise.all(
        Array.from({ length: this.concurrency }, () => this.worker.runOnce()),
      );
      processedAny = results.some(Boolean);
    } catch (error) {
      this.logger.error("Extraction worker loop failed.", {
        message:
          error instanceof Error ? error.message : "Unexpected worker error.",
      });
    } finally {
      this.#schedule(processedAny ? 0 : this.pollIntervalMs);
    }
  }
}
