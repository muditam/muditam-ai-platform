import { z } from "zod";

export const chatRoleSchema = z.enum(["user", "assistant"]);

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
  observations: z.array(chatObservationSchema).max(300).default([]),
  recentMessages: z.array(z.object({
    role: chatRoleSchema,
    content: z.string().min(1).max(4000),
  })).max(20).default([]),
});

export const chatCategorySchema = z.enum([
  "GREETING",
  "REPORT_VALUES",
  "DIABETES_EDUCATION",
  "LIFESTYLE_EDUCATION",
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
  model: string | null;
  promptVersion: string;
  guardrailStage: "INPUT" | "MODEL" | "OUTPUT" | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}
