import { z } from "zod";

export const ALLOWABLE_CHAT_CATEGORIES = [
  "GREETING",
  "REPORT_VALUES",
  "REPORT_COMPARISON",
  "GLYCEMIC_EDUCATION",
  "DIABETES_EDUCATION",
  "LIFESTYLE_EDUCATION",
] as const;

export const CHAT_CATEGORIES = [
  ...ALLOWABLE_CHAT_CATEGORIES,
  "PRODUCT_RECOMMENDATION",
  "MEDICATION_OR_DIAGNOSIS",
  "OFF_TOPIC",
  "URGENT_SAFETY",
] as const;

export const allowableChatCategorySchema = z.enum(
  ALLOWABLE_CHAT_CATEGORIES,
);
export const chatCategorySchema = z.enum(CHAT_CATEGORIES);
export const chatDecisionSchema = z.enum(["ALLOW", "REFUSE", "SAFETY"]);

export const createConversationSchema = z.object({
  userId: z.string().trim().min(1).max(200),
});

export const askChatQuestionSchema = z.object({
  userId: z.string().trim().min(1).max(200),
  question: z.string().trim().min(1),
});

export const citedBiomarkerSchema = z.object({
  reportId: z.string().trim().min(1),
  biomarkerId: z.string().trim().min(1),
});

export const chatProviderResultSchema = z.object({
  decision: chatDecisionSchema,
  category: chatCategorySchema,
  answer: z.string(),
  citedBiomarkers: z.array(citedBiomarkerSchema),
  citedKnowledgeIds: z.array(z.string().trim().min(1)),
  usedReportData: z.boolean(),
  usedKnowledgeBase: z.boolean(),
});

export type AllowableChatCategory = z.infer<
  typeof allowableChatCategorySchema
>;
export type ChatCategory = z.infer<typeof chatCategorySchema>;
export type ChatDecision = z.infer<typeof chatDecisionSchema>;
export type ChatProviderResult = z.infer<typeof chatProviderResultSchema>;
