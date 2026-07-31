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
  options: { minimum?: number; maximum?: number } = {},
) =>
  z.preprocess(
    (value) =>
      value === undefined || value === "" ? defaultValue : Number(value),
    z
      .number()
      .int()
      .min(options.minimum ?? 1)
      .max(options.maximum ?? Number.MAX_SAFE_INTEGER),
  );

const numberFromEnvironment = (
  defaultValue: number,
  options: { minimum?: number; maximum?: number } = {},
) =>
  z.preprocess(
    (value) =>
      value === undefined || value === "" ? defaultValue : Number(value),
    z
      .number()
      .finite()
      .min(options.minimum ?? Number.NEGATIVE_INFINITY)
      .max(options.maximum ?? Number.POSITIVE_INFINITY),
  );

const csvFromEnvironment = <T extends [string, ...string[]]>(
  values: T,
  defaultValue: T[number][],
) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === "") return defaultValue;
      if (Array.isArray(value)) return value;
      if (typeof value === "string") {
        return value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
      }
      return value;
    },
    z.array(z.enum(values)).min(1),
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
  METABOLIC_CHAT_ENABLED: booleanFromEnvironment(false),
  METABOLIC_CHAT_MODEL: z.string().trim().min(1).default("gpt-4o-mini"),
  METABOLIC_CHAT_ALLOWED_CATEGORIES: csvFromEnvironment(
    [
      "GREETING",
      "REPORT_VALUES",
      "REPORT_COMPARISON",
      "GLYCEMIC_EDUCATION",
      "DIABETES_EDUCATION",
      "LIFESTYLE_EDUCATION",
    ],
    [
      "GREETING",
      "REPORT_VALUES",
      "REPORT_COMPARISON",
      "GLYCEMIC_EDUCATION",
      "DIABETES_EDUCATION",
      "LIFESTYLE_EDUCATION",
    ],
  ),
  METABOLIC_CHAT_ALLOWED_REPORT_STATUSES: csvFromEnvironment(
    ["NEEDS_REVIEW", "READY"],
    ["NEEDS_REVIEW", "READY"],
  ),
  METABOLIC_CHAT_MAX_QUESTIONS_PER_WINDOW: integerFromEnvironment(20),
  METABOLIC_CHAT_MAX_REPORTS_PER_CONVERSATION:
    integerFromEnvironment(3),
  METABOLIC_CHAT_LIMIT_WINDOW_MINUTES: integerFromEnvironment(1_440),
  METABOLIC_CHAT_MAX_QUESTION_CHARS: integerFromEnvironment(1_000),
  METABOLIC_CHAT_MAX_HISTORY_MESSAGES: integerFromEnvironment(10),
  METABOLIC_CHAT_MAX_ANSWER_WORDS: integerFromEnvironment(180),
  METABOLIC_CHAT_MAX_OUTPUT_TOKENS: integerFromEnvironment(700),
  METABOLIC_CHAT_MAX_KNOWLEDGE_RESULTS: integerFromEnvironment(5),
  METABOLIC_CHAT_MIN_MARKER_CONFIDENCE: numberFromEnvironment(0.6, {
    minimum: 0,
    maximum: 1,
  }),
  METABOLIC_CHAT_PERSONA_NAME: z
    .string()
    .trim()
    .min(1)
    .default("Muditam Diabetes Guide"),
  METABOLIC_CHAT_TONE: z
    .string()
    .trim()
    .min(1)
    .default("calm, clear, respectful, and supportive"),
  METABOLIC_CHAT_RESPONSE_STYLE: z
    .string()
    .trim()
    .min(1)
    .default("Use simple English, short paragraphs, and practical explanations."),
  METABOLIC_CHAT_REJECTION_MESSAGE: z
    .string()
    .trim()
    .min(1)
    .default(
      "I can only help with diabetes, blood-sugar health, and blood-report questions.",
    ),
  METABOLIC_CHAT_MISSING_REPORT_DATA_MESSAGE: z
    .string()
    .trim()
    .min(1)
    .default(
      "I could not find that value clearly in this report. Please check the report or ask about a value that was extracted.",
    ),
  METABOLIC_CHAT_SAFETY_MESSAGE: z
    .string()
    .trim()
    .min(1)
    .default(
      "This may need urgent medical attention. Please contact a doctor or local emergency service now. Do not wait for this chat.",
    ),
  METABOLIC_CHAT_DISCLAIMER: z
    .string()
    .trim()
    .min(1)
    .default(
      "This is general diabetes education. Report-based answers use automatically extracted data. It is not a diagnosis or a replacement for a doctor.",
    ),
  METABOLIC_OPENAI_STORE: booleanFromEnvironment(false),
  METABOLIC_OPENAI_TIMEOUT_MS: integerFromEnvironment(120_000),

  METABOLIC_MAX_FILE_BYTES: integerFromEnvironment(10 * 1024 * 1024),
  METABOLIC_MAX_PDF_PAGES: integerFromEnvironment(30),
  METABOLIC_MAX_REPORTS_PER_USER: integerFromEnvironment(10),
  METABOLIC_REQUIRE_SUBJECT_ID_FOR_UPLOAD: booleanFromEnvironment(true),

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
