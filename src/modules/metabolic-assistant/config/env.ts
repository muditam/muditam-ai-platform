import { z } from "zod";

const optionalString = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0
      ? undefined
      : value,
  z.string().trim().min(1).optional(),
);

const booleanFromEnvironment = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === "") return defaultValue;
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
    return value;
  }, z.boolean());

const integerFromEnvironment = (
  defaultValue: number,
  options: { minimum?: number } = {},
) =>
  z.preprocess(
    (value) =>
      value === undefined || value === "" ? defaultValue : Number(value),
    z.number().int().min(options.minimum ?? 1),
  );

const optionalNumber = z.preprocess(
  (value) =>
    value === undefined || value === "" ? undefined : Number(value),
  z.number().finite().nonnegative().optional(),
);

export const metabolicEnvironmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  ENABLE_METABOLIC_ASSISTANT: booleanFromEnvironment(false),
  METABOLIC_HOST: z.string().trim().min(1).default("0.0.0.0"),
  METABOLIC_PORT: integerFromEnvironment(3100),
  METABOLIC_API_PREFIX: z
    .string()
    .trim()
    .regex(/^\/[a-z0-9/_-]*[a-z0-9_-]$/i)
    .default("/api/v1/metabolic-assistant"),
  METABOLIC_LOG_LEVEL: z
    .enum(["debug", "info", "warn", "error"])
    .default("info"),

  METABOLIC_MONGODB_URI: optionalString,

  METABOLIC_OPENAI_API_KEY: optionalString,
  METABOLIC_EXTRACTION_MODEL: z
    .string()
    .trim()
    .min(1)
    .default("gpt-4o-mini"),
  METABOLIC_CHAT_MODEL: optionalString,
  METABOLIC_OPENAI_STORE: booleanFromEnvironment(false),
  METABOLIC_OPENAI_TIMEOUT_MS: integerFromEnvironment(120_000),

  METABOLIC_MAX_FILE_BYTES: integerFromEnvironment(10 * 1024 * 1024),
  METABOLIC_MAX_PDF_PAGES: integerFromEnvironment(30),

  METABOLIC_STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  METABOLIC_LOCAL_STORAGE_DIR: z
    .string()
    .trim()
    .min(1)
    .default(".data/metabolic-assistant/reports"),
  METABOLIC_STORAGE_BUCKET: optionalString,
  METABOLIC_STORAGE_PREFIX: z
    .string()
    .trim()
    .min(1)
    .default("metabolic-assistant/reports"),
  METABOLIC_STORAGE_REGION: optionalString,
  METABOLIC_STORAGE_ENDPOINT: optionalString,
  METABOLIC_STORAGE_ACCESS_KEY_ID: optionalString,
  METABOLIC_STORAGE_SECRET_ACCESS_KEY: optionalString,

  METABOLIC_WORKER_ENABLED: booleanFromEnvironment(false),
  METABOLIC_WORKER_CONCURRENCY: integerFromEnvironment(1),
  METABOLIC_MAX_JOB_ATTEMPTS: integerFromEnvironment(3),
  METABOLIC_WORKER_POLL_INTERVAL_MS: integerFromEnvironment(2_000),
  METABOLIC_JOB_LEASE_MS: integerFromEnvironment(180_000),

  METABOLIC_REPORT_RETENTION_DAYS: integerFromEnvironment(30),
  METABOLIC_CHAT_RETENTION_DAYS: integerFromEnvironment(30),
  METABOLIC_DAILY_SPEND_LIMIT: optionalNumber,
});

export type MetabolicEnvironment = z.infer<
  typeof metabolicEnvironmentSchema
>;

export function loadMetabolicEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): MetabolicEnvironment {
  return metabolicEnvironmentSchema.parse(source);
}
