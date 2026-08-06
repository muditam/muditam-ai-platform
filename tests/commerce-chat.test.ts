import { describe, expect, it } from "vitest";
import {
  answerCommerceChat,
  commerceRetrievalQuery,
  type CommerceModelProvider,
} from "../src/commerce/commerce-engine.js";
import { formatCommerceCopy } from "../src/commerce/guardrails.js";
import type { KnowledgeEntry } from "../src/chat/knowledge.js";

const baseRequest = {
  conversationId: "commerce-conversation-1",
  visitorId: "visitor-1",
  channel: "shopify_web" as const,
  language: "en" as const,
  recentMessages: [],
};

const productKnowledge: KnowledgeEntry[] = [
  {
    key: "product:sugar-defend-pro:overview",
    title: "Sugar Defend Pro — product information",
    content: "Product: Sugar Defend Pro\nPublished description: Supports healthy glucose metabolism.",
    contentHi: "प्रोडक्ट: Sugar Defend Pro",
    keywords: ["Sugar Defend Pro", "blood sugar"],
    sourceName: "Muditam Ayurveda",
    sourceUrl: "https://www.muditam.com/products/sugar-defend-pro",
    version: "test",
    sourceType: "product",
    productSlug: "sugar-defend-pro",
    recommendationEligible: true,
  },
  {
    key: "product:karela-jamun-fizz:overview",
    title: "Karela Jamun Fizz — product information",
    content: "Product: Karela Jamun Fizz\nPublished description: A convenient daily drink format.",
    contentHi: "प्रोडक्ट: Karela Jamun Fizz",
    keywords: ["Karela Jamun Fizz", "drink"],
    sourceName: "Muditam Ayurveda",
    sourceUrl: "https://www.muditam.com/products/karela-jamun-fizz",
    version: "test",
    sourceType: "product",
    productSlug: "karela-jamun-fizz",
    recommendationEligible: true,
  },
];

describe("commerce chat", () => {
  it("carries product context into retrieval for affirmative follow-up questions", async () => {
    const query = commerceRetrievalQuery({
      ...baseRequest,
      message: "yes do you have it?",
      recentMessages: [
        { role: "user", content: "What ingredients are in Sugar Defend Pro?" },
        { role: "assistant", content: "Sugar Defend Pro contains a blend of 15+ ingredients. Would you like the complete composition?" },
      ],
    });

    expect(query).toContain("Sugar Defend Pro");
    expect(query).toContain("complete composition");
    expect(query).toContain("yes do you have it?");
  });

  it("uses conversation context when retrieving knowledge for a follow-up", async () => {
    let retrievalQuery = "";
    const response = await answerCommerceChat(
      {
        ...baseRequest,
        message: "yes do you have it?",
        recentMessages: [
          { role: "assistant", content: "Sugar Defend Pro has 15+ ingredients. Would you like the complete composition?" },
        ],
      },
      {
        answer: async () => ({
          model: "test-model",
          result: {
            decision: "ALLOW",
            category: "PRODUCT_INFORMATION",
            answer: "Yes, I have the verified composition details for Sugar Defend Pro.",
            followUp: null,
            citedKnowledgeKeys: [productKnowledge[0]!.key],
            recommendations: [],
          },
        }),
      },
      async (query) => {
        retrievalQuery = query;
        return productKnowledge;
      },
    );

    expect(retrievalQuery).toContain("Sugar Defend Pro");
    expect(retrievalQuery).toContain("complete composition");
    expect(response.decision).toBe("ALLOW");
  });

  it("removes internal knowledge keys and enforces concise storefront copy", () => {
    const verbose = `${Array.from({ length: 58 }, (_, index) => `word${index}`).join(" ")} [product:sugar-defend-pro:overview]`;
    const formatted = formatCommerceCopy(verbose, 55);

    expect(formatted).not.toContain("product:sugar-defend-pro");
    expect(formatted.split(/\s+/)).toHaveLength(55);
    expect(formatted.endsWith("…")).toBe(true);
  });

  it("removes AI-style em dashes from storefront copy", () => {
    expect(formatCommerceCopy("Hi — great to meet you! How can I help today?", 55))
      .toBe("Hi, great to meet you! How can I help today?");
  });

  it("returns verified product cards separately from conversational messages", async () => {
    const provider: CommerceModelProvider = {
      answer: async () => ({
        model: "test-model",
        usage: { inputTokens: 20, outputTokens: 30, totalTokens: 50 },
        result: {
          decision: "ALLOW",
          category: "PRODUCT_DISCOVERY",
          answer: "Hello there! For balanced blood-sugar support, these two options can fit different preferences.",
          followUp: "Would you prefer a convenient drink or capsules?",
          citedKnowledgeKeys: productKnowledge.map((entry) => entry.key),
          recommendations: [
            { productSlug: "karela-jamun-fizz", reason: "Convenient daily drink format" },
            { productSlug: "sugar-defend-pro", reason: "Capsule-based metabolic support" },
          ],
        },
      }),
    };

    const response = await answerCommerceChat(
      { ...baseRequest, message: "Suggest something for daily wellness" },
      provider,
      async () => productKnowledge,
    );

    expect(response.decision).toBe("ALLOW");
    expect(response.messages).toHaveLength(2);
    expect(response.messages[0]?.text).toContain("these two options");
    expect(response.recommendedProducts).toEqual([
      {
        productSlug: "karela-jamun-fizz",
        name: "Karela Jamun Fizz",
        productUrl: "https://www.muditam.com/products/karela-jamun-fizz",
        reason: "Convenient daily drink format",
      },
      {
        productSlug: "sugar-defend-pro",
        name: "Sugar Defend Pro",
        productUrl: "https://www.muditam.com/products/sugar-defend-pro",
        reason: "Capsule-based metabolic support",
      },
    ]);
    expect(response.handoff).toBeNull();
    expect(response.usage.totalTokens).toBe(50);
  });

  it("handles diabetes product discovery deterministically from verified products", async () => {
    let generated = false;
    const response = await answerCommerceChat(
      { ...baseRequest, language: "hinglish", message: "diabetes ke liye hai kuch?" },
      { answer: async () => { generated = true; throw new Error("should not run"); } },
      async () => productKnowledge,
    );

    expect(generated).toBe(false);
    expect(response.model).toBeNull();
    expect(response.decision).toBe("ALLOW");
    expect(response.messages[0]?.text).toContain("Sugar Defend Pro");
    expect(response.recommendedProducts.map((item) => item.productSlug)).toEqual([
      "sugar-defend-pro",
      "karela-jamun-fizz",
    ]);
  });

  it("does not allow the model to invent a product card", async () => {
    const response = await answerCommerceChat(
      { ...baseRequest, message: "What should I buy?" },
      {
        answer: async () => ({
          model: "test-model",
          result: {
            decision: "ALLOW",
            category: "PRODUCT_DISCOVERY",
            answer: "Sugar Defend Pro is the relevant available option.",
            followUp: null,
            citedKnowledgeKeys: [productKnowledge[0]!.key],
            recommendations: [
              { productSlug: "invented-product", reason: "Invented" },
              { productSlug: "sugar-defend-pro", reason: "Available in verified knowledge" },
            ],
          },
        }),
      },
      async () => productKnowledge,
    );

    expect(response.recommendedProducts.map((item) => item.productSlug)).toEqual(["sugar-defend-pro"]);
  });

  it("grounds a valid recommendation from retrieved product knowledge when the model omits its citation", async () => {
    const response = await answerCommerceChat(
      { ...baseRequest, message: "Any product for diabetes?" },
      {
        answer: async () => ({
          model: "test-model",
          result: {
            decision: "ALLOW",
            category: "PRODUCT_DISCOVERY",
            answer: "Sugar Defend Pro is a convenient option for daily metabolic wellness support.",
            followUp: null,
            citedKnowledgeKeys: [],
            recommendations: [{ productSlug: "sugar-defend-pro", reason: "Daily metabolic wellness support" }],
          },
        }),
      },
      async () => productKnowledge,
    );

    expect(response.decision).toBe("ALLOW");
    expect(response.recommendedProducts[0]?.productSlug).toBe("sugar-defend-pro");
    expect(response.knowledgeReferences[0]?.key).toBe("product:sugar-defend-pro:overview");
  });

  it("refuses an uncited product answer instead of displaying an unsupported recommendation", async () => {
    const response = await answerCommerceChat(
      { ...baseRequest, message: "What should I buy?" },
      {
        answer: async () => ({
          model: "test-model",
          result: {
            decision: "ALLOW",
            category: "PRODUCT_DISCOVERY",
            answer: "Buy this product.",
            followUp: null,
            citedKnowledgeKeys: [],
            recommendations: [{ productSlug: "sugar-defend-pro", reason: "Unsupported" }],
          },
        }),
      },
      async () => productKnowledge,
    );

    expect(response.decision).toBe("REFUSE");
    expect(response.recommendedProducts).toEqual([]);
    expect(response.guardrailStage).toBe("OUTPUT");
  });

  it("routes medication compatibility to a doctor before retrieval or model generation", async () => {
    let retrieved = false;
    let generated = false;
    const response = await answerCommerceChat(
      { ...baseRequest, message: "Is it safe to take with metformin?" },
      {
        answer: async () => {
          generated = true;
          throw new Error("should not run");
        },
      },
      async () => {
        retrieved = true;
        return productKnowledge;
      },
    );

    expect(retrieved).toBe(false);
    expect(generated).toBe(false);
    expect(response.decision).toBe("HANDOFF");
    expect(response.handoff?.queue).toBe("doctor");
    expect(response.messages[0]?.text).toContain("chat or a callback");
  });

  it("handles an urgent message deterministically", async () => {
    const response = await answerCommerceChat(
      { ...baseRequest, message: "He is unconscious and cannot breathe" },
      { answer: async () => { throw new Error("should not run"); } },
      async () => { throw new Error("should not retrieve"); },
    );

    expect(response.decision).toBe("SAFETY");
    expect(response.category).toBe("URGENT_SAFETY");
    expect(response.model).toBeNull();
  });

  it("returns verified call and WhatsApp actions for expert help", async () => {
    const response = await answerCommerceChat(
      { ...baseRequest, message: "I want expert help" },
      { answer: async () => { throw new Error("should not run"); } },
      async () => { throw new Error("should not retrieve"); },
    );

    expect(response.decision).toBe("HANDOFF");
    expect(response.handoff).toMatchObject({
      queue: "dietitian",
      phoneDisplay: "8989174741",
      phoneHref: "tel:+918989174741",
      whatsappUrl: "https://api.whatsapp.com/send?phone=919625368707&text=Hi%0AI%20would%20like%20to%20connect%20to%20an%20expert",
    });
  });

  it("answers consultation pricing follow-ups with contact actions and no product cards", async () => {
    const response = await answerCommerceChat(
      {
        ...baseRequest,
        message: "is it free or you take money?",
        recentMessages: [{ role: "assistant", content: "Would you like a consultation for your diet plan?" }],
      },
      { answer: async () => { throw new Error("should not run"); } },
      async () => { throw new Error("should not retrieve"); },
    );

    expect(response.messages[0]?.text).toContain("completely FREE");
    expect(response.decision).toBe("HANDOFF");
    expect(response.recommendedProducts).toEqual([]);
    expect(response.handoff?.phoneDisplay).toBe("8989174741");
    expect(response.handoff?.whatsappUrl).toContain("phone=919625368707");
  });

  it("adds contact actions whenever generated copy offers to book a consultation", async () => {
    const response = await answerCommerceChat(
      { ...baseRequest, message: "Can someone help with a diet plan?" },
      {
        answer: async () => ({
          model: "test-model",
          result: {
            decision: "ALLOW",
            category: "PRODUCT_DISCOVERY",
            answer: "Our dietitian can help with personalized diet guidance.",
            followUp: "Would you like me to book a free consultation for you?",
            citedKnowledgeKeys: [productKnowledge[0]!.key],
            recommendations: [{ productSlug: "sugar-defend-pro", reason: "Daily support" }],
          },
        }),
      },
      async () => productKnowledge,
    );

    expect(response.decision).toBe("HANDOFF");
    expect(response.category).toBe("EXPERT_HANDOFF");
    expect(response.recommendedProducts).toEqual([]);
    expect(response.handoff?.queue).toBe("dietitian");
  });

  it("understands an affirmative reply after offering expert support", async () => {
    const response = await answerCommerceChat(
      {
        ...baseRequest,
        message: "yes please",
        recentMessages: [{ role: "assistant", content: "Would you like me to connect you with an expert?" }],
      },
      { answer: async () => { throw new Error("should not run"); } },
      async () => { throw new Error("should not retrieve"); },
    );

    expect(response.decision).toBe("HANDOFF");
    expect(response.handoff?.whatsappUrl).toContain("phone=919625368707");
  });

  it("uses the approved concise response for general doctor-guidance questions", async () => {
    const response = await answerCommerceChat(
      { ...baseRequest, message: "Do I need doctor guidance or can I take this product?" },
      { answer: async () => { throw new Error("should not run"); } },
      async () => { throw new Error("should not retrieve"); },
    );

    expect(response.messages).toEqual([{
      type: "text",
      text: "All our products are health supplements and can generally be taken without consulting a doctor. However, if you want to be extra sure, we offer FREE doctor consultations to provide personalized guidance.",
    }]);
    expect(response.decision).toBe("HANDOFF");
    expect(response.handoff?.queue).toBe("doctor");
    expect(response.handoff?.phoneDisplay).toBe("8989174741");
    expect(response.handoff?.whatsappUrl).toContain("phone=919625368707");
  });

  it("recognizes a doctor-consultation question despite a joined-word typo", async () => {
    const response = await answerCommerceChat(
      { ...baseRequest, message: "do ineed doctor consultation?" },
      { answer: async () => { throw new Error("should not run"); } },
      async () => { throw new Error("should not retrieve"); },
    );

    expect(response.messages[0]?.text).toBe(
      "All our products are health supplements and can generally be taken without consulting a doctor. However, if you want to be extra sure, we offer FREE doctor consultations to provide personalized guidance.",
    );
    expect(response.recommendedProducts).toEqual([]);
    expect(response.handoff?.queue).toBe("doctor");

    for (const message of [
      "do ineed doctor consultation?",
      "do i need docter consultion?",
      "is doctor consulation required?",
      "kya mujhe docter ki advice chahiye?",
    ]) {
      const typoResponse = await answerCommerceChat(
        { ...baseRequest, message },
        { answer: async () => { throw new Error("should not run"); } },
        async () => { throw new Error("should not retrieve"); },
      );
      expect(typoResponse.messages[0]?.text).toBe(response.messages[0]?.text);
      expect(typoResponse.recommendedProducts).toEqual([]);
      expect(typoResponse.handoff?.queue).toBe("doctor");
    }
  });

  it("does not use the general consultation copy when medication is involved", async () => {
    const response = await answerCommerceChat(
      { ...baseRequest, message: "Do I need a doctor before taking this with metformin medication?" },
      { answer: async () => { throw new Error("should not run"); } },
      async () => { throw new Error("should not retrieve"); },
    );

    expect(response.messages[0]?.text).toContain("medication is involved");
    expect(response.messages[0]?.text).not.toContain("generally be taken without consulting");
  });

  it("treats a disclosed heart condition as a consultation handoff, not an emergency", async () => {
    const response = await answerCommerceChat(
      { ...baseRequest, message: "haan mai heart patient hu" },
      { answer: async () => { throw new Error("should not run"); } },
      async () => { throw new Error("should not retrieve"); },
    );

    expect(response.decision).toBe("HANDOFF");
    expect(response.category).toBe("EXPERT_HANDOFF");
    expect(response.messages[0]?.text).toContain("heart condition");
    expect(response.messages[0]?.text).toContain("FREE supplement consultation");
    expect(response.messages[0]?.text).not.toContain("emergency");
    expect(response.messages[0]?.text).not.toContain("pregnan");
    expect(response.handoff?.queue).toBe("doctor");
  });

  it("treats diabetes recommendation intent as product discovery, not diagnosis disclosure", async () => {
    let generated = false;
    const response = await answerCommerceChat(
      { ...baseRequest, language: "hinglish", message: "aap mujhe diabetes ke liye koi product recommend kar skte ho?" },
      {
        answer: async () => {
          generated = true;
          return {
            model: "test-model",
            result: {
              decision: "ALLOW" as const,
              category: "PRODUCT_DISCOVERY" as const,
              answer: "Diabetes-related wellness support ke liye Sugar Defend Pro aur Karela Jamun Fizz consider kar sakte hain.",
              followUp: "Aap capsules prefer karte hain ya drink format?",
              citedKnowledgeKeys: productKnowledge.map((entry) => entry.key),
              recommendations: [
                { productSlug: "sugar-defend-pro", reason: "Broader daily metabolic support" },
                { productSlug: "karela-jamun-fizz", reason: "Convenient drink format" },
              ],
            },
          };
        },
      },
      async () => productKnowledge,
    );

    expect(generated).toBe(false);
    expect(response.category).toBe("PRODUCT_DISCOVERY");
    expect(response.recommendedProducts).toHaveLength(2);
    expect(response.messages[0]?.text).not.toContain("consult your doctor");
  });

  it("uses a concise dosage handoff without unrelated precaution lists", async () => {
    const response = await answerCommerceChat(
      { ...baseRequest, message: "Heart Defend Pro ki exact dosage kya hai?" },
      { answer: async () => { throw new Error("should not run"); } },
      async () => { throw new Error("should not retrieve"); },
    );

    expect(response.decision).toBe("HANDOFF");
    expect(response.messages[0]?.text).toContain("dosage can vary");
    expect(response.messages[0]?.text).not.toContain("pregnan");
    expect(response.messages[0]?.text).not.toContain("breastfeed");
  });

  it("downgrades an unsupported model emergency classification to expert handoff", async () => {
    const response = await answerCommerceChat(
      { ...baseRequest, message: "I have a general health concern" },
      {
        answer: async () => ({
          model: "test-model",
          result: {
            decision: "SAFETY",
            category: "URGENT_SAFETY",
            answer: "Emergency",
            followUp: null,
            citedKnowledgeKeys: [],
            recommendations: [],
          },
        }),
      },
      async () => [],
    );

    expect(response.decision).toBe("HANDOFF");
    expect(response.category).toBe("EXPERT_HANDOFF");
    expect(response.messages[0]?.text).not.toContain("emergency");
    expect(response.guardrailStage).toBe("OUTPUT");
  });

  it("replaces model knowledge about another company with a Muditam-only redirect", async () => {
    const response = await answerCommerceChat(
      { ...baseRequest, language: "hi", message: "Nestle kya hai?" },
      {
        answer: async () => ({
          model: "test-model",
          result: {
            decision: "ALLOW",
            category: "OFF_TOPIC",
            answer: "Nestlé is a multinational food and beverage company.",
            followUp: "Would you like to know about its products?",
            citedKnowledgeKeys: [],
            recommendations: [],
          },
        }),
      },
      async () => [],
    );

    expect(response.decision).toBe("REFUSE");
    expect(response.messages[0]?.text).toContain("केवल Muditam");
    expect(response.messages[0]?.text).not.toContain("Nestlé");
    expect(response.guardrailStage).toBe("OUTPUT");
  });

  it("uses Hinglish for an off-topic Roman Hindi question", async () => {
    const response = await answerCommerceChat(
      { ...baseRequest, language: "hinglish", message: "Nestle kya hai?" },
      {
        answer: async () => ({
          model: "test-model",
          result: {
            decision: "ALLOW",
            category: "OFF_TOPIC",
            answer: "Nestle is another company.",
            followUp: null,
            citedKnowledgeKeys: [],
            recommendations: [],
          },
        }),
      },
      async () => [],
    );

    expect(response.messages[0]?.text).toContain("Main sirf Muditam");
    expect(response.messages[0]?.text).toContain("kya jaanna chahenge");
    expect(response.messages[0]?.text).not.toContain("Nestle is");
  });
});
