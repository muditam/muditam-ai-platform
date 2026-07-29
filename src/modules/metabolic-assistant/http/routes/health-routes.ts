import { Router } from "express";
import type { MetabolicEnvironment } from "../../config/env.js";
import { healthResponseSchema } from "../../contracts/api.js";

export interface HealthRouteDependencies {
  environment: MetabolicEnvironment;
  now?: () => Date;
}

export function createHealthRouter({
  environment,
  now = () => new Date(),
}: HealthRouteDependencies): Router {
  const router = Router();

  router.get("/", (_request, response) => {
    const payload = healthResponseSchema.parse({
      ok: true,
      data: {
        service: "metabolic-assistant",
        status: environment.ENABLE_METABOLIC_ASSISTANT
          ? "ready"
          : "disabled",
        version: "0.1.0",
        timestamp: now().toISOString(),
      },
      error: null,
      requestId: String(response.locals.requestId),
    });

    response.json(payload);
  });

  return router;
}
