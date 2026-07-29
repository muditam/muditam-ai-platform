import "dotenv/config";
import { createServer } from "node:http";
import {
  createMetabolicApp,
  createMetabolicLogger,
  getMetabolicFeatureFlags,
  loadMetabolicEnvironment,
} from "./index.js";

const environment = loadMetabolicEnvironment();
const logger = createMetabolicLogger(environment.METABOLIC_LOG_LEVEL);
const flags = getMetabolicFeatureFlags(environment);
const app = createMetabolicApp({ environment, logger });
const server = createServer(app);

server.listen(
  environment.METABOLIC_PORT,
  environment.METABOLIC_HOST,
  () => {
    logger.info("Metabolic assistant server started.", {
      enabled: flags.metabolicAssistantEnabled,
      host: environment.METABOLIC_HOST,
      port: environment.METABOLIC_PORT,
      apiPrefix: environment.METABOLIC_API_PREFIX,
    });
  },
);

const shutdown = (signal: NodeJS.Signals): void => {
  logger.info("Metabolic assistant server stopping.", { signal });
  server.close((error) => {
    if (error) {
      logger.error("Metabolic assistant server failed to stop.", { signal });
      process.exitCode = 1;
    }
  });
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
