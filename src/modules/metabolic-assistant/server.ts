import "dotenv/config";
import { createServer } from "node:http";
import type { Connection } from "mongoose";
import { OpenAIReportExtractor } from "./adapters/extraction/openai-report-extractor.js";
import { LocalReportStorage } from "./adapters/storage/local-report-storage.js";
import { MetabolicAssistantError } from "./contracts/errors.js";
import {
  closeMetabolicDatabase,
  connectMetabolicDatabase,
} from "./database/connect.js";
import { getMetabolicProcessingJobModel } from "./database/models/metabolic-processing-job.js";
import { getMetabolicReportModel } from "./database/models/metabolic-report.js";
import {
  createMetabolicApp,
  createMetabolicLogger,
  getMetabolicFeatureFlags,
  loadMetabolicEnvironment,
} from "./index.js";
import { ReportRepository } from "./repositories/report-repository.js";
import { ProcessingJobRepository } from "./repositories/processing-job-repository.js";
import { ReportIngestionService } from "./services/report-ingestion-service.js";
import {
  ExtractionWorker,
  ExtractionWorkerRunner,
} from "./workers/extraction-worker.js";

async function main(): Promise<void> {
  const environment = loadMetabolicEnvironment();
  const logger = createMetabolicLogger(environment.METABOLIC_LOG_LEVEL);
  const flags = getMetabolicFeatureFlags(environment);
  let database: Connection | undefined;
  let reportService: ReportIngestionService | undefined;
  let workerRunner: ExtractionWorkerRunner | undefined;

  if (flags.metabolicAssistantEnabled) {
    if (environment.METABOLIC_MONGODB_URI === undefined) {
      throw new MetabolicAssistantError(
        "INVALID_CONFIGURATION",
        "METABOLIC_MONGODB_URI is required when the module is enabled.",
      );
    }
    if (environment.METABOLIC_STORAGE_PROVIDER !== "local") {
      throw new MetabolicAssistantError(
        "INVALID_CONFIGURATION",
        "Only local private report storage is implemented in this phase.",
      );
    }

    database = await connectMetabolicDatabase(
      environment.METABOLIC_MONGODB_URI,
    );
    const reportModel = getMetabolicReportModel(database);
    const jobModel = getMetabolicProcessingJobModel(database);
    const repository = new ReportRepository(reportModel, jobModel);
    const storage = new LocalReportStorage(
      environment.METABOLIC_LOCAL_STORAGE_DIR,
    );
    reportService = new ReportIngestionService(
      repository,
      storage,
    );

    if (environment.METABOLIC_WORKER_ENABLED) {
      if (environment.METABOLIC_OPENAI_API_KEY === undefined) {
        throw new MetabolicAssistantError(
          "INVALID_CONFIGURATION",
          "METABOLIC_OPENAI_API_KEY is required when the extraction worker is enabled.",
        );
      }
      const extractor = new OpenAIReportExtractor({
        apiKey: environment.METABOLIC_OPENAI_API_KEY,
        model: environment.METABOLIC_EXTRACTION_MODEL,
        store: environment.METABOLIC_OPENAI_STORE,
        timeoutMs: environment.METABOLIC_OPENAI_TIMEOUT_MS,
      });
      const worker = new ExtractionWorker({
        jobs: new ProcessingJobRepository(jobModel),
        reports: repository,
        storage,
        extractor,
        logger,
        leaseMs: environment.METABOLIC_JOB_LEASE_MS,
        maxAttempts: environment.METABOLIC_MAX_JOB_ATTEMPTS,
      });
      workerRunner = new ExtractionWorkerRunner(
        worker,
        environment.METABOLIC_WORKER_POLL_INTERVAL_MS,
        environment.METABOLIC_WORKER_CONCURRENCY,
        logger,
      );
    }
  }

  const appDependencies: Parameters<typeof createMetabolicApp>[0] = {
    environment,
    logger,
  };
  if (reportService !== undefined) appDependencies.reportService = reportService;
  const server = createServer(createMetabolicApp(appDependencies));

  server.listen(
    environment.METABOLIC_PORT,
    environment.METABOLIC_HOST,
    () => {
      logger.info("Metabolic assistant server started.", {
        enabled: flags.metabolicAssistantEnabled,
        host: environment.METABOLIC_HOST,
        port: environment.METABOLIC_PORT,
        apiPrefix: environment.METABOLIC_API_PREFIX,
        extractionWorkerEnabled: environment.METABOLIC_WORKER_ENABLED,
        extractionModel: environment.METABOLIC_EXTRACTION_MODEL,
      });
      workerRunner?.start();
    },
  );

  let stopping = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info("Metabolic assistant server stopping.", { signal });
    await new Promise<void>((resolve, reject) => {
      server.close((serverError) => {
        if (serverError !== undefined) reject(serverError);
        else resolve();
      });
    });
    await workerRunner?.stop();
    if (database !== undefined) await closeMetabolicDatabase(database);
  };

  process.once("SIGINT", (signal) => {
    void shutdown(signal).catch((error: unknown) => {
      logger.error("Metabolic assistant server failed to stop.", {
        message: error instanceof Error ? error.message : "Unknown error",
      });
      process.exitCode = 1;
    });
  });
  process.once("SIGTERM", (signal) => {
    void shutdown(signal).catch((error: unknown) => {
      logger.error("Metabolic assistant server failed to stop.", {
        message: error instanceof Error ? error.message : "Unknown error",
      });
      process.exitCode = 1;
    });
  });
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      service: "metabolic-assistant",
      level: "error",
      message:
        error instanceof Error ? error.message : "Unexpected startup failure.",
    }),
  );
  process.exitCode = 1;
});
