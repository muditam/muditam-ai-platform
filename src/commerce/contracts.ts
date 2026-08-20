import { z } from "zod";

const commerceRoleSchema = z.enum(["user", "assistant"]);

export const commerceChatRequestSchema = z.object({
  conversationId: z.string().min(1).max(200),
  visitorId: z.string().min(1).max(200),
  customerId: z.string().min(1).max(200).nullable().optional(),
  channel: z.enum(["shopify_web", "ios", "android", "internal_preview"]),
  language: z.enum(["en", "hi", "hinglish"]).default("en"),
  message: z.string().trim().min(1).max(2000),
  recentMessages: z.array(z.object({
    role: commerceRoleSchema,
    content: z.string().min(1).max(4000),
  })).max(20).default([]),
  pageContext: z.object({
    url: z.string().url().max(2000),
    pageType: z.enum(["home", "collection", "product", "cart", "other"]),
    productSlug: z.string().min(1).max(200).nullable().optional(),
  }).optional(),
});

export const commerceCategorySchema = z.enum([
  "GREETING",
  "PRODUCT_DISCOVERY",
  "PRODUCT_INFORMATION",
  "PRODUCT_COMPARISON",
  "ORDER_OR_SUPPORT",
  "EXPERT_HANDOFF",
  "OFF_TOPIC",
  "URGENT_SAFETY",
]);

export const modelCommerceResultSchema = z.object({
  decision: z.enum(["ALLOW", "HANDOFF", "REFUSE", "SAFETY"]),
  category: commerceCategorySchema,
  answer: z.string().trim(),
  followUp: z.string().trim().max(300).nullable(),
  citedKnowledgeKeys: z.array(z.string()).max(12),
  recommendations: z.array(z.object({
    productSlug: z.string().min(1).max(200),
    reason: z.string().trim().min(1).max(240),
  })).max(2),
});

export const widgetConfigSchema = z.object({
  themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  botTitle: z.string().trim().min(1).max(60).optional(),
  openingMessage: z.string().trim().min(1).max(500).optional(),
  widgetSize: z.enum(["small", "medium", "large"]).optional(),
  launcherSize: z.enum(["small", "medium", "large"]).optional(),
  widgetPosition: z.enum(["left", "right"]).optional(),
  gapFromSide: z.number().min(0).max(200).optional(),
  gapFromBottom: z.number().min(0).max(400).optional(),
  pulseEffect: z.boolean().optional(),
  pulseColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  launcherImage: z.string().max(180_000).regex(/^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/).nullable().optional(),
  launcherRingColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  nudgeText: z.string().trim().min(1).max(60).optional(),
  nudgeBackgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const botFlowTextDataSchema = z.object({
  title: z.string().trim().min(2).max(160),
  content: z.string().trim().min(10).max(30_000),
});

export const discountConfigSchema = z.object({
  sharingMode: z.enum(["disabled", "relevant", "all"]),
  autoUpdate: z.boolean().default(false),
  discounts: z.array(z.object({
    id: z.string().max(100).default(""),
    code: z.string().trim().min(1).max(80),
    description: z.string().trim().max(300).default(""),
    value: z.string().trim().max(100).default(""),
    active: z.boolean().default(true),
  })).max(100),
});

export type CommerceChatRequest = z.infer<typeof commerceChatRequestSchema>;
export type ModelCommerceResult = z.infer<typeof modelCommerceResultSchema>;

export interface CommerceChatResponse {
  decision: ModelCommerceResult["decision"];
  category: z.infer<typeof commerceCategorySchema>;
  messages: Array<{ type: "text"; text: string }>;
  recommendedProducts: Array<{
    productSlug: string;
    name: string;
    productUrl: string;
    reason: string;
  }>;
  knowledgeReferences: Array<{
    key: string;
    title: string;
    sourceName: string;
    sourceUrl: string;
  }>;
  handoff: null | {
    queue: "support" | "dietitian" | "doctor";
    reason: string;
    phoneDisplay: string;
    phoneHref: string;
    whatsappUrl: string;
  };
  orderTracking?: null | {
    orderName: string;
    status: string;
    statusDetail: string;
    productNames: string[];
    placedAt: string | null;
    courier: string | null;
    trackingNumberMasked: string | null;
    currentLocation: string | null;
    expectedDeliveryDate: string | null;
    latestEventAt: string | null;
  };
  orderTrackings?: Array<NonNullable<CommerceChatResponse["orderTracking"]>>;
  model: string | null;
  promptVersion: string;
  guardrailStage: "INPUT" | "MODEL" | "OUTPUT" | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}
