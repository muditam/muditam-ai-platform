import "dotenv/config";
import { createServer } from "node:http";
import type { Connection } from "mongoose";
import { OpenAIReportExtractor } from "./adapters/extraction/openai-report-extractor.js";
import { OpenAIReportChatProvider } from "./adapters/chat/openai-report-chat-provider.js";
import { LocalReportStorage } from "./adapters/storage/local-report-storage.js";
import { buildMetabolicChatPolicy } from "./config/chat-policy.js";
import { MetabolicAssistantError } from "./contracts/errors.js";
import {
  closeMetabolicDatabase,
  connectMetabolicDatabase,
} from "./database/connect.js";
import { getMetabolicProcessingJobModel } from "./database/models/metabolic-processing-job.js";
import { getMetabolicReportModel } from "./database/models/metabolic-report.js";
import { getMetabolicReportUsageModel } from "./database/models/metabolic-report-usage.js";
import { getMetabolicKnowledgeEntryModel } from "./database/models/metabolic-knowledge-entry.js";
import { getMetabolicChatConversationModel } from "./database/models/metabolic-chat-conversation.js";
import { getMetabolicChatMessageModel } from "./database/models/metabolic-chat-message.js";
import { getMetabolicChatUsageModel } from "./database/models/metabolic-chat-usage.js";
import {
  createMetabolicApp,
  createMetabolicLogger,
  getMetabolicFeatureFlags,
  loadMetabolicEnvironment,
} from "./index.js";
import { ReportRepository } from "./repositories/report-repository.js";
import { ReportUsageRepository } from "./repositories/report-usage-repository.js";
import { KnowledgeRepository } from "./repositories/knowledge-repository.js";
import { ChatRepository } from "./repositories/chat-repository.js";
import { ChatUsageRepository } from "./repositories/chat-usage-repository.js";
import { ProcessingJobRepository } from "./repositories/processing-job-repository.js";
import { DiabetesChatService } from "./services/diabetes-chat-service.js";
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
  let chatService: DiabetesChatService | undefined;
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
    const reportUsage = new ReportUsageRepository(
      getMetabolicReportUsageModel(database),
    );
    const storage = new LocalReportStorage(
      environment.METABOLIC_LOCAL_STORAGE_DIR,
    );
    const chatPolicy = buildMetabolicChatPolicy(environment);
    if (chatPolicy.enabled) {
      if (environment.METABOLIC_OPENAI_API_KEY === undefined) {
        throw new MetabolicAssistantError(
          "INVALID_CONFIGURATION",
          "METABOLIC_OPENAI_API_KEY is required when diabetes chat is enabled.",
        );
      }
      const chatRepository = new ChatRepository(
        getMetabolicChatConversationModel(database),
        getMetabolicChatMessageModel(database),
      );
      const chatUsage = new ChatUsageRepository(
        getMetabolicChatUsageModel(database),
      );
      const knowledge = new KnowledgeRepository(
        getMetabolicKnowledgeEntryModel(database),
      );
      const chatProvider = new OpenAIReportChatProvider({
        apiKey: environment.METABOLIC_OPENAI_API_KEY,
        policy: chatPolicy,
        store: environment.METABOLIC_OPENAI_STORE,
        timeoutMs: environment.METABOLIC_OPENAI_TIMEOUT_MS,
      });
      chatService = new DiabetesChatService(
        repository,
        chatRepository,
        chatUsage,
        knowledge,
        chatProvider,
        chatPolicy,
      );
    }

    reportService = new ReportIngestionService(
      repository,
      storage,
      {
        usage: reportUsage,
        maximum: environment.METABOLIC_MAX_REPORTS_PER_USER,
        requireSubjectId:
          environment.METABOLIC_REQUIRE_SUBJECT_ID_FOR_UPLOAD,
      },
      chatService,
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
  if (chatService !== undefined) appDependencies.chatService = chatService;
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
        chatEnabled: environment.METABOLIC_CHAT_ENABLED,
        chatModel: environment.METABOLIC_CHAT_MODEL,
        maxReportsPerUser: environment.METABOLIC_MAX_REPORTS_PER_USER,
        maxReportsPerConversation:
          environment.METABOLIC_CHAT_MAX_REPORTS_PER_CONVERSATION,
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
