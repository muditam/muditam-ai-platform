import { describe, expect, it } from "vitest";
import type { KnowledgeEntry } from "../src/chat/knowledge.js";
import { answerCommerceChat, type CommerceModelProvider } from "../src/commerce/commerce-engine.js";

const base = {
  conversationId: "real-message-regression",
  visitorId: "real-visitor",
  channel: "shopify_web" as const,
  language: "en" as const,
  recentMessages: [],
};

function product(
  slug: string,
  name: string,
  concern: "blood_sugar" | "liver" | "heart" | null,
  price: number,
  options: { tagRank?: number; overallRank?: number; dosage?: string; certifications?: string } = {},
): KnowledgeEntry {
  return {
    key: `product:${slug}:overview`,
    title: `${name} — product information`,
    content: [
      `Product: ${name}`,
      `Published description: ${name} is formulated for daily wellness support.`,
      options.dosage && `Published dosage: ${options.dosage}`,
      options.certifications && `Published certifications: ${options.certifications}`,
      `Shopify variants: ${JSON.stringify({ title: "1 Pack", price, compareAtPrice: null, available: true })}`,
      "Shelf life: 18 months.",
    ].filter(Boolean).join("\n"),
    contentHi: `Verified information for ${name}.`,
    keywords: [name, concern ?? "wellness"],
    sourceName: "Muditam Ayurveda",
    sourceUrl: `https://www.muditam.com/products/${slug}`,
    version: "real-regression",
    sourceType: "product",
    productSlug: slug,
    recommendationEligible: true,
    ...(concern ? { recommendationConcern: concern } : {}),
    tagRank: options.tagRank ?? null,
    overallRank: options.overallRank ?? null,
  };
}

const catalogue: KnowledgeEntry[] = [
  product("karela-jamun-fizz", "Karela Jamun Fizz", "blood_sugar", 465, {
    tagRank: 1, overallRank: 1,
    dosage: "Take 1 tablet in the morning and 1 tablet before dinner.",
    certifications: "FSSAI, GMP, USFDA documentation, WHO-GMP",
  }),
  product("berberine-pro", "Berberine Pro", "blood_sugar", 1_475, { tagRank: 2, overallRank: 4 }),
  product("sugar-defend-pro", "Sugar Defend Pro", "blood_sugar", 1_325, { tagRank: 3, overallRank: 3 }),
  product("liver-defend-pro", "Liver Defend Pro", "liver", 715, { tagRank: 1, overallRank: 5 }),
  product("liver-fix", "Liver Fix", "liver", 650, { tagRank: 2, overallRank: 2 }),
  product("core-essentials", "Core Essentials", null, 420, { overallRank: 6 }),
];

const offTopicProvider: CommerceModelProvider = {
  answer: async () => ({
    model: "regression-model",
    usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    result: {
      decision: "REFUSE",
      category: "OFF_TOPIC",
      answer: "I cannot help with that.",
      followUp: null,
      citedKnowledgeKeys: [],
      recommendations: [],
    },
  }),
};

describe("real storefront message regressions", () => {
  const safetyCases = [
    "can i take your products during pregnancy?",
    "can i take your products during pregnacy?",
    "is karela jamun fizz safe in pregnancy",
    "can I use Muditam supplements while breastfeeding?",
  ];

  for (const message of safetyCases) {
    it(`routes safety wording to expert guidance: ${message}`, async () => {
      const result = await answerCommerceChat(
        { ...base, message },
        { answer: async () => { throw new Error("model must not run"); } },
        async () => { throw new Error("retrieval must not run"); },
      );
      expect(result.decision).toBe("HANDOFF");
      expect(result.category).toBe("EXPERT_HANDOFF");
      expect(result.messages[0]?.text).toMatch(/consult your healthcare provider first|healthcare provider se consult/iu);
      expect(result.messages[0]?.text).toMatch(/dietitian|support team/iu);
      expect(result.recommendedProducts).toEqual([]);
      expect(result.handoff?.queue).toBe("dietitian");
    });
  }

  it("routes a refund directly to support", async () => {
    const result = await answerCommerceChat(
      { ...base, message: "i need refund" }, offTopicProvider, async () => catalogue,
    );
    expect(result.messages[0]?.text).toContain("handled by our support team");
    expect(result.handoff?.queue).toBe("support");
  });

  it("uses current catalogue prices for the cheapest-product question", async () => {
    const result = await answerCommerceChat(
      { ...base, message: "what is your cheapest product?" }, offTopicProvider, async () => catalogue,
    );
    expect(result.messages[0]?.text).toContain("Core Essentials, starting at ₹420");
    expect(result.recommendedProducts.map((item) => item.productSlug)).toEqual(["core-essentials"]);
  });

  it("keeps a named cure claim anchored to the named product", async () => {
    const result = await answerCommerceChat(
      { ...base, message: "can karela jamun fizz cure diabetes?" }, offTopicProvider, async () => catalogue,
    );
    expect(result.messages[0]?.text).toContain("does not cure diabetes");
    expect(result.recommendedProducts.map((item) => item.productSlug)).toEqual(["karela-jamun-fizz"]);
    expect(result.handoff?.queue).toBe("dietitian");
  });

  it("does not show products for a diabetes-disappearance question", async () => {
    const result = await answerCommerceChat(
      { ...base, message: "how quickly will my diabetes disaapear?" }, offTopicProvider, async () => catalogue,
    );
    expect(result.messages[0]?.text).toContain("do not cure diabetes");
    expect(result.recommendedProducts).toEqual([]);
    expect(result.handoff?.queue).toBe("dietitian");
  });

  it("returns every configured diabetes product in admin priority order", async () => {
    const result = await answerCommerceChat(
      { ...base, message: "any product for diabetes?" }, offTopicProvider, async () => catalogue,
    );
    expect(result.recommendedProducts.map((item) => item.productSlug)).toEqual([
      "karela-jamun-fizz", "berberine-pro", "sugar-defend-pro",
    ]);
  });

  it("returns every configured liver product in admin priority order", async () => {
    const result = await answerCommerceChat(
      { ...base, message: "lever ke liye koi product?", language: "hinglish" }, offTopicProvider, async () => catalogue,
    );
    expect(result.recommendedProducts.map((item) => item.productSlug)).toEqual([
      "liver-defend-pro", "liver-fix",
    ]);
  });

  it("answers published dosage for the product actually named", async () => {
    const result = await answerCommerceChat(
      { ...base, message: "karela fizz ka dosage kya hai?", language: "hinglish" }, offTopicProvider, async () => catalogue,
    );
    expect(result.messages[0]?.text).toContain("Karela Jamun Fizz ka published dosage");
    expect(result.recommendedProducts.map((item) => item.productSlug)).toEqual(["karela-jamun-fizz"]);
  });

  it("answers certification using only the named product data", async () => {
    const result = await answerCommerceChat(
      { ...base, message: "is karela jamun fizz FDA and WHO GMP approved?" }, offTopicProvider, async () => catalogue,
    );
    expect(result.messages[0]?.text).toContain("USFDA documentation, WHO-GMP");
    expect(result.messages[0]?.text).toContain("should not be described as FDA approval");
  });

  it("recognizes a typo in a short catalogue request", async () => {
    const result = await answerCommerceChat(
      { ...base, message: "wgat are muditam prodcuts?" }, offTopicProvider, async () => catalogue,
    );
    expect(result.recommendedProducts).toHaveLength(catalogue.length);
    expect(result.messages[0]?.text).toContain("best-selling product");
  });

  it("offers support for an unsupported but in-scope concern", async () => {
    const result = await answerCommerceChat(
      { ...base, message: "can you recommend a product for skin concern?" }, offTopicProvider, async () => [],
    );
    expect(result.category).toBe("ORDER_OR_SUPPORT");
    expect(result.handoff?.queue).toBe("support");
  });

  it("returns support actions when verified catalogue retrieval fails", async () => {
    const result = await answerCommerceChat(
      { ...base, message: "tell me about a Muditam product" },
      offTopicProvider,
      async () => { throw new Error("database unavailable"); },
    );
    expect(result.category).toBe("ORDER_OR_SUPPORT");
    expect(result.messages[0]?.text).toContain("connect with our support team");
    expect(result.handoff?.queue).toBe("support");
  });

  it("returns support actions when the answer provider fails", async () => {
    const result = await answerCommerceChat(
      { ...base, message: "please help with a Muditam wellness question" },
      { answer: async () => { throw new Error("invalid structured response"); } },
      async () => catalogue,
    );
    expect(result.category).toBe("ORDER_OR_SUPPORT");
    expect(result.messages[0]?.text).toContain("connect with our support team");
    expect(result.handoff?.queue).toBe("support");
  });

  it("keeps a question about another company off-topic", async () => {
    const result = await answerCommerceChat(
      { ...base, message: "what is Nestle?" }, offTopicProvider, async () => [],
    );
    expect(result.category).toBe("OFF_TOPIC");
    expect(result.handoff).toBeNull();
  });

  it("does not treat a stable heart-patient disclosure as an emergency", async () => {
    const result = await answerCommerceChat(
      { ...base, message: "haan mai heart patient hu", language: "hinglish" }, offTopicProvider, async () => catalogue,
    );
    expect(result.decision).toBe("HANDOFF");
    expect(result.category).toBe("EXPERT_HANDOFF");
    expect(result.messages[0]?.text).not.toContain("emergency");
  });

  it("keeps an actual urgent symptom on the emergency route", async () => {
    const result = await answerCommerceChat(
      { ...base, message: "I have chest pain and cannot breathe" }, offTopicProvider, async () => catalogue,
    );
    expect(result.category).toBe("URGENT_SAFETY");
    expect(result.decision).toBe("SAFETY");
  });
});
