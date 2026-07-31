import { z } from "zod";

export const knowledgeCategorySchema = z.enum([
  "DIABETES_BASICS",
  "GLYCEMIC_TESTS",
  "GLUCOSE_TARGETS",
  "LIFESTYLE",
  "SAFETY",
]);

export const diabetesKnowledgeEntrySchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9_-]+$/),
  title: z.string().trim().min(1),
  category: knowledgeCategorySchema,
  content: z.string().trim().min(1),
  keywords: z.array(z.string().trim().min(1)).min(1),
  source: z.object({
    name: z.string().trim().min(1),
    url: z.string().url(),
    reviewedAt: z.string().date(),
  }),
  version: z.string().trim().min(1),
  active: z.boolean(),
});

export type DiabetesKnowledgeEntry = z.infer<
  typeof diabetesKnowledgeEntrySchema
>;
