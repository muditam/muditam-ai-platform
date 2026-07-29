import express, { type Express } from "express";
import type { MetabolicEnvironment } from "../config/env.js";
import type { MetabolicLogger } from "../observability/logger.js";
import { createMetabolicErrorHandler } from "./middleware/error-handler.js";
import { attachRequestId } from "./middleware/request-id.js";
import { createHealthRouter } from "./routes/health-routes.js";

export interface CreateMetabolicAppDependencies {
  environment: MetabolicEnvironment;
  logger: MetabolicLogger;
  now?: () => Date;
}

export function createMetabolicApp({
  environment,
  logger,
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
