import type { MetabolicEnvironment } from "./env.js";

export interface MetabolicFeatureFlags {
  metabolicAssistantEnabled: boolean;
  extractionWorkerEnabled: boolean;
}

export function getMetabolicFeatureFlags(
  environment: MetabolicEnvironment,
): MetabolicFeatureFlags {
  return {
    metabolicAssistantEnabled: environment.ENABLE_METABOLIC_ASSISTANT,
    extractionWorkerEnabled:
      environment.ENABLE_METABOLIC_ASSISTANT &&
      environment.METABOLIC_WORKER_ENABLED,
  };
}
