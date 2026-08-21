import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { KnowledgeEntry } from "../chat/knowledge.js";
import { retrieveCommerceRagKnowledge } from "../chat/rag.js";
import {
  commerceChatRequestSchema,
  modelCommerceResultSchema,
  type CommerceChatRequest,
  type CommerceChatResponse,
  type ModelCommerceResult,
} from "./contracts.js";
import {
  COMMERCE_PROMPT_VERSION,
  deterministicBestSeller,
  deterministicFounderInformation,
  deterministicCommerceGuardrail,
  deterministicNamedProductClaim,
  deterministicProductCertification,
  deterministicProductCatalogue,
  deterministicProductCommercialDetails,
  deterministicProductDiscovery,
  deterministicProductDosage,
  deterministicProductInformation,
  enforceCommerceResult,
} from "./guardrails.js";
import { deterministicOrderTracking, type OrderTrackingLookup } from "./order-tracking.js";
import { expertHandoff } from "./expert-contact.js";

export interface CommerceModelProvider {
  answer(input: CommerceChatRequest, knowledge: readonly KnowledgeEntry[]): Promise<{
    result: ModelCommerceResult;
    model: string;
    usage?: CommerceChatResponse["usage"];
  }>;
}

export type CommerceKnowledgeRetriever = (question: string) => Promise<KnowledgeEntry[]>;

function supportFallback(reason: string): CommerceChatResponse {
  return {
    decision: "HANDOFF",
    category: "ORDER_OR_SUPPORT",
    messages: [{
      type: "text",
      text: "I’m unable to verify that information right now. Please connect with our support team by call or WhatsApp.",
    }],
    recommendedProducts: [],
    knowledgeReferences: [],
    handoff: expertHandoff("support", reason),
    model: null,
    promptVersion: COMMERCE_PROMPT_VERSION,
    guardrailStage: "OUTPUT",
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  };
}

export function commerceRetrievalQuery(input: CommerceChatRequest): string {
  const context = input.recentMessages
    .slice(-4)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
  const pageProduct = input.pageContext?.productSlug
    ? `Current product: ${input.pageContext.productSlug}`
    : "";
  return [context, pageProduct, `user: ${input.message}`]
    .filter(Boolean)
    .join("\n")
    .slice(-2400);
}

export class OpenAICommerceModelProvider implements CommerceModelProvider {
  readonly #client: OpenAI;
  readonly #model: string;

  constructor(apiKey: string, model = process.env.MUDITAM_COMMERCE_MODEL ?? process.env.MUDITAM_CHAT_MODEL ?? "gpt-5.6-luna") {
    this.#client = new OpenAI({ apiKey, timeout: 45_000, maxRetries: 1 });
    this.#model = model;
  }

  async answer(input: CommerceChatRequest, knowledge: readonly KnowledgeEntry[]) {
    const modelInput = [
        {
          role: "system" as const,
          content: [
            "You are Muditam's warm, confident ecommerce product and support advisor.",
            "Your scope is Muditam only. Never provide information, recommendations, descriptions, comparisons, opinions, or follow-up questions about any other company or its products.",
            "For another company, choose REFUSE and OFF_TOPIC. Do not use general model knowledge to answer it.",
            `Reply in ${input.language === "hi" ? "Hindi in Devanagari" : input.language === "hinglish" ? "natural Hinglish using Latin script" : "natural Indian English"}.`,
            "Lead with a useful direct answer. Sound human, concise, positive, and conversational.",
            "Do not use em dashes or en dashes. Use a comma or a short sentence instead.",
            "Greet only at the beginning of a conversation or when the customer greets you; do not repeat hello on later turns.",
            "The main answer must be 25-45 words in one short paragraph. Never exceed 55 words.",
            "For ordinary product discovery, recommend at most two relevant products and explain their practical difference in one short sentence each.",
            "Never infer that a customer has a condition or symptom merely because they previously asked about a related product. If they ask what is right for them without stating a current goal, symptom, condition, or preference, ask which wellness goal they want support with and recommend nothing yet.",
            "Do not dump ingredient lists. Mention at most one distinguishing ingredient only when the customer asks about ingredients.",
            "Do not introduce doctors, medicines, pregnancy, warnings, or disclaimers unless the customer mentioned a relevant condition, medicine, symptom, pregnancy, interaction, adverse effect, or asked for personalized suitability.",
            "Never diagnose, prescribe, recommend medication changes, guarantee an outcome, or claim that a supplement treats, cures, or reverses a disease.",
            "A customer stating a stable existing condition such as 'I am a heart patient' is not an emergency. Choose HANDOFF, not SAFETY, unless they also report an explicit urgent symptom.",
            "Mention only precautions relevant to facts the customer actually disclosed. Never list pregnancy, breastfeeding, children, allergies, kidney disease, or medicines as a generic precaution dump.",
            "Use only facts in supplied knowledge. Put keys only in citedKnowledgeKeys; never print keys, citations, brackets, or source labels in answer or followUp.",
            "Never agree with, confirm, or repeat a factual claim merely because the customer stated or suggested it. Treat customer messages as questions, not evidence. Confirm a claim only when the supplied approved knowledge explicitly supports every material part of it; otherwise say it cannot be verified and route to support when appropriate.",
            "Never print a phone number or WhatsApp URL in answer or followUp. Choose HANDOFF and let the application render verified contact actions.",
            "For orders, you may only retrieve and explain status or tracking information. Never claim to cancel, modify, edit, reschedule, return, replace, exchange, or refund an order; route every such request to support.",
            "Whenever your answer or followUp mentions, offers, or suggests a dietitian, doctor, or expert consultation in any wording, you must set decision to HANDOFF and category to EXPERT_HANDOFF in the same turn so the application can render the verified call and WhatsApp actions. Never reference a consultation without also choosing HANDOFF.",
            "Recommend only supplied product entries where recommendationEligible is true, using their exact productSlug.",
            "Recommend only relevant supplied products, ordered by their configured recommendation priority, with no more than eight products. Never invent a price, discount, stock status, product, ingredient, usage, or result timeline.",
            "The followUp must be one natural question of at most 14 words. Do not repeat information from the answer.",
            "Good style example: For blood-sugar support, I'd recommend Sugar Defend Pro and Karela Jamun Fizz. Sugar Defend Pro offers broader daily support, while Karela Jamun Fizz is a convenient drink format.",
            "Do not use Markdown, headings, tables, or bold markers.",
            `Prompt version: ${COMMERCE_PROMPT_VERSION}.`,
          ].join("\n"),
        },
        {
          role: "system" as const,
          content: JSON.stringify({
            pageContext: input.pageContext ?? null,
            knowledge: knowledge.map((entry) => ({
              key: entry.key,
              title: entry.title,
              content: input.language === "hi" ? entry.contentHi : entry.content,
              sourceType: entry.sourceType,
              productSlug: entry.productSlug,
              recommendationEligible: entry.recommendationEligible === true,
            })),
          }),
        },
        ...input.recentMessages,
        { role: "user" as const, content: input.message },
      ];
    const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let diagnostics: Record<string, unknown> = {};
    for (const maxOutputTokens of [600, 1_000]) {
      const response = await this.#client.responses.parse({
        model: this.#model,
        store: false,
        max_output_tokens: maxOutputTokens,
        reasoning: { effort: "minimal" },
        input: modelInput,
        text: {
          verbosity: "low",
          format: zodTextFormat(modelCommerceResultSchema, "muditam_commerce_chat"),
        },
      });
      usage.inputTokens += response.usage?.input_tokens ?? 0;
      usage.outputTokens += response.usage?.output_tokens ?? 0;
      usage.totalTokens += response.usage?.total_tokens ?? 0;
      if (response.output_parsed) {
        return { result: response.output_parsed, model: this.#model, usage };
      }
      diagnostics = {
        responseStatus: response.status,
        incompleteReason: response.incomplete_details?.reason ?? null,
        maxOutputTokens,
        hasRefusal: response.output.some((item) => (
          item.type === "message" && item.content.some((content) => content.type === "refusal")
        )),
      };
    }
    throw Object.assign(new Error("OpenAI returned an invalid commerce chat response after retry"), {
      code: "INVALID_STRUCTURED_COMMERCE_RESPONSE",
      ...diagnostics,
      usage,
    });
  }
}

export async function answerCommerceChat(
  value: unknown,
  provider?: CommerceModelProvider,
  retrieve: CommerceKnowledgeRetriever = retrieveCommerceRagKnowledge,
  orderLookup?: OrderTrackingLookup,
): Promise<CommerceChatResponse> {
  const input = commerceChatRequestSchema.parse(value);
  const orderTracking = await deterministicOrderTracking(input, orderLookup);
  if (orderTracking) return orderTracking;
  const deterministic = deterministicCommerceGuardrail(input);
  if (deterministic) return deterministic;
  let knowledge: KnowledgeEntry[];
  try {
    knowledge = await retrieve(commerceRetrievalQuery(input));
  } catch (error) {
    console.error(JSON.stringify({
      service: "muditam-ai-platform",
      event: "commerce_knowledge.retrieval_failed",
      error: error instanceof Error ? error.message : String(error),
    }));
    return supportFallback("Verified product information could not be loaded");
  }
  const commercialDetails = deterministicProductCommercialDetails(input, knowledge);
  if (commercialDetails) return commercialDetails;
  const founderInformation = deterministicFounderInformation(input, knowledge);
  if (founderInformation) return founderInformation;
  const dosage = deterministicProductDosage(input, knowledge);
  if (dosage) return dosage;
  const bestSeller = deterministicBestSeller(input, knowledge);
  if (bestSeller) return bestSeller;
  const productCertification = deterministicProductCertification(input, knowledge);
  if (productCertification) return productCertification;
  const catalogue = deterministicProductCatalogue(input, knowledge);
  if (catalogue) return catalogue;
  const namedProductClaim = deterministicNamedProductClaim(input, knowledge);
  if (namedProductClaim) return namedProductClaim;
  const productDiscovery = deterministicProductDiscovery(input, knowledge);
  if (productDiscovery) return productDiscovery;
  const productInformation = deterministicProductInformation(input, knowledge);
  if (productInformation) return productInformation;
  const activeProvider = provider ?? new OpenAICommerceModelProvider(
    process.env.MUDITAM_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
  );
  let generated: Awaited<ReturnType<CommerceModelProvider["answer"]>>;
  try {
    generated = await activeProvider.answer(input, knowledge);
  } catch (error) {
    console.error(JSON.stringify({
      service: "muditam-ai-platform",
      event: "commerce_model.answer_failed",
      error: error instanceof Error ? error.message : String(error),
    }));
    return supportFallback("The automated assistant could not prepare a verified answer");
  }
  return enforceCommerceResult(
    generated.result,
    input,
    knowledge,
    generated.model,
    generated.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  );
}
