import express, { type Express } from "express";
import type { MetabolicEnvironment } from "../config/env.js";
import type { MetabolicLogger } from "../observability/logger.js";
import type { ReportOperations } from "../services/report-ingestion-service.js";
import type { DiabetesChatOperations } from "../services/diabetes-chat-service.js";
import { ChatController } from "./controllers/chat-controller.js";
import { ReportController } from "./controllers/report-controller.js";
import { createMetabolicErrorHandler } from "./middleware/error-handler.js";
import { attachRequestId } from "./middleware/request-id.js";
import { createHealthRouter } from "./routes/health-routes.js";
import { createChatRouter } from "./routes/chat-routes.js";
import { createReportRouter } from "./routes/report-routes.js";

export interface CreateMetabolicAppDependencies {
  environment: MetabolicEnvironment;
  logger: MetabolicLogger;
  reportService?: ReportOperations;
  chatService?: DiabetesChatOperations;
  now?: () => Date;
}

export function createMetabolicApp({
  environment,
  logger,
  reportService,
  chatService,
  now,
}: CreateMetabolicAppDependencies): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(attachRequestId);
  app.use(express.json({ limit: "1mb" }));

  const healthDependencies: Parameters<typeof createHealthRouter>[0] = {
    environment,
  };
  if (now !== undefined) healthDependencies.now = now;

  app.use(
    `${environment.METABOLIC_API_PREFIX}/health`,
    createHealthRouter(healthDependencies),
  );
  if (environment.ENABLE_METABOLIC_ASSISTANT && reportService !== undefined) {
    app.use(
      `${environment.METABOLIC_API_PREFIX}/reports`,
      createReportRouter(new ReportController(reportService), environment),
    );
  }
  if (environment.ENABLE_METABOLIC_ASSISTANT && chatService !== undefined) {
    app.use(
      `${environment.METABOLIC_API_PREFIX}/reports`,
      createChatRouter(new ChatController(chatService)),
    );
  }

  app.use((_request, response) => {
    response.status(404).json({
      ok: false,
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Route not found.",
      },
      requestId: String(response.locals.requestId),
    });
  });

  app.use(createMetabolicErrorHandler(logger));
  return app;
}
