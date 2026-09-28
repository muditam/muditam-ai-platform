import { z } from "zod";

export const chatRoleSchema = z.enum(["user", "assistant"]);
export const chatChannelSchema = z.enum(["mobile_app", "shopify_web"]);
export const chatAudienceSchema = z.enum(["anonymous_visitor", "verified_customer"]);

const appFactSchema = z.object({
  key: z.string().min(1).max(120),
  value: z.string().max(500),
});

const appMetricSchema = z.union([z.number(), z.string().max(120), z.null()]);

export const mobileAppContextSchema = z.object({
  asOf: z.string().datetime(),
  user: z.object({
    name: z.string().max(160).nullable(),
    age: z.number().int().min(0).max(150).nullable(),
    gender: z.string().max(80).nullable(),
    preferredLanguage: z.string().max(40).nullable(),
  }),
  fitness: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    stepSource: z.enum(["expo_pedometer", "health_connect", "manual", "not_connected"]),
    stepSourceExplanation: z.string().max(800),
    workoutExplanation: z.string().max(800),
    metrics: z.record(z.string().max(80), appMetricSchema),
    targets: z.record(z.string().max(80), z.number()),
    completedPlans: z.array(z.string().max(80)).max(20),
  }).nullable(),
  progress: z.object({
    currentStreakDays: z.number().int().min(0),
    bestStreakDays: z.number().int().min(0),
    weekCompletedDays: z.number().int().min(0).max(7),
    weekTotalDays: z.literal(7),
    weekRemainingCompletionDays: z.number().int().min(0).max(7),
    todayCompletedTasks: z.number().int().min(0),
    todayTotalTasks: z.number().int().min(0),
  }).nullable(),
  diet: z.object({
    profileComplete: z.boolean(),
    planStatus: z.string().max(40),
    startDate: z.string().max(20).nullable(),
    endDate: z.string().max(20).nullable(),
    answersUsedForPlan: z.array(appFactSchema).max(30),
    targets: z.array(appFactSchema).max(20),
  }).nullable(),
  kit: z.object({
    hasPurchased: z.boolean(),
    currentKitNumber: z.number().int().min(1),
    currentKitStartedAt: z.string().datetime().nullable(),
    cycleDays: z.number().int().min(1).max(365),
    daysOnCurrentKit: z.number().int().min(0),
    daysUntilNextKit: z.number().int().min(0),
    reorderReady: z.boolean(),
    name: z.string().max(200).nullable(),
    condition: z.string().max(200).nullable(),
    items: z.array(z.object({
      name: z.string().max(200),
      quantity: z.number().int().min(1),
    })).max(30),
  }).nullable(),
  quiz: z.object({
    completedAt: z.string().datetime().nullable(),
    answers: z.array(appFactSchema).max(80),
    result: z.object({
      conditionKey: z.string().max(200).nullable(),
      diseaseKeys: z.array(z.string().max(100)).max(20),
      metrics: z.array(appFactSchema).max(20),
      affectedOrgans: z.array(z.object({
        name: z.string().max(100),
        status: z.string().max(100),
        signals: z.array(z.string().max(240)).max(20),
      })).max(20),
      rootCauses: z.array(z.object({
        title: z.string().max(160),
        signals: z.array(z.string().max(240)).max(20),
      })).max(20),
    }).nullable(),
  }).nullable(),
}).strict();

export const chatObservationSchema = z.object({
  observationId: z.string().min(1).max(200),
  reportId: z.string().min(1).max(200),
  canonicalCode: z.string().min(1).max(120).nullable(),
  displayName: z.string().min(1).max(160),
  rawName: z.string().min(1).max(300).nullable().optional(),
  value: z.union([z.number(), z.string(), z.object({
    type: z.string(),
    numeric: z.number().optional(),
    comparator: z.string().optional(),
    lower: z.number().optional(),
    upper: z.number().optional(),
    text: z.string().optional(),
  })]),
  unit: z.string().max(80).nullable().optional(),
  referenceRange: z.unknown().nullable().optional(),
  mappingStatus: z.enum(["MAPPED", "POSSIBLE_MATCH", "AMBIGUOUS", "UNMAPPED"]),
  suggestedCanonicalCode: z.string().min(1).max(120).nullable().optional(),
  validationStatus: z.enum(["VALID", "REVIEW_REQUIRED"]),
  decision: z.enum(["AUTO_ACCEPT", "USER_CONFIRMATION", "REVIEW_REQUIRED"]),
  confidence: z.number().min(0).max(1),
  collectedAt: z.string().datetime().optional(),
});

export const internalChatRequestSchema = z.object({
  conversationId: z.string().min(1).max(200),
  message: z.string().trim().min(1).max(2000),
  language: z.enum(["en", "hi"]).default("en"),
  channel: chatChannelSchema.default("mobile_app"),
  audience: chatAudienceSchema.default("verified_customer"),
  appContext: mobileAppContextSchema.optional(),
  observations: z.array(chatObservationSchema).max(300).default([]),
  recentMessages: z.array(z.object({
    role: chatRoleSchema,
    content: z.string().min(1).max(4000),
  })).max(20).default([]),
}).superRefine((request, context) => {
  if (request.observations.length && (request.channel !== "mobile_app" || request.audience !== "verified_customer")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["observations"],
      message: "Report observations require an authenticated mobile customer context",
    });
  }
  if (request.appContext && (request.channel !== "mobile_app" || request.audience !== "verified_customer")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["appContext"],
      message: "Application context requires an authenticated mobile customer context",
    });
  }
});

export const chatCategorySchema = z.enum([
  "GREETING",
  "REPORT_VALUES",
  "DIABETES_EDUCATION",
  "LIFESTYLE_EDUCATION",
  "PRODUCT_INFORMATION",
  "PLATFORM_INFORMATION",
  "APP_INFORMATION",
  "MEDICATION_OR_DIAGNOSIS",
  "OFF_TOPIC",
  "URGENT_SAFETY",
]);

export const modelChatResultSchema = z.object({
  decision: z.enum(["ALLOW", "REFUSE", "SAFETY"]),
  category: chatCategorySchema,
  answer: z.string().trim(),
  citedObservationIds: z.array(z.string()),
  citedKnowledgeKeys: z.array(z.string()),
  recommendations: z.array(z.object({
    productSlug: z.string().min(1).max(200),
    reason: z.string().trim().min(1).max(240),
  })).max(8),
});

export const appUiActionSchema = z.object({
  type: z.literal("NAVIGATE"),
  target: z.enum(["REELS", "GAMES"]),
  label: z.string().min(1).max(80),
});

export type InternalChatRequest = z.infer<typeof internalChatRequestSchema>;
export type ModelChatResult = z.infer<typeof modelChatResultSchema>;

export interface InternalChatResponse {
  decision: ModelChatResult["decision"];
  category: ModelChatResult["category"];
  answer: string;
  citations: Array<{
    observationId: string;
    reportId: string;
    displayName: string;
    value: InternalChatRequest["observations"][number]["value"];
    unit?: string | null;
    mappingStatus: InternalChatRequest["observations"][number]["mappingStatus"];
    validationStatus: InternalChatRequest["observations"][number]["validationStatus"];
    decision: InternalChatRequest["observations"][number]["decision"];
    confidence: number;
  }>;
  knowledgeReferences: Array<{
    key: string;
    title: string;
    sourceName: string;
    sourceUrl: string;
  }>;
  recommendedProducts?: Array<{
    productSlug: string;
    name: string;
    productUrl: string;
    reason: string;
  }>;
  uiActions?: Array<z.infer<typeof appUiActionSchema>>;
  model: string | null;
  promptVersion: string;
  guardrailStage: "INPUT" | "MODEL" | "OUTPUT" | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}
