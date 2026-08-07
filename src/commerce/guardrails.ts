import type { KnowledgeEntry } from "../chat/knowledge.js";
import { formatChatAnswer } from "../chat/guardrails.js";
import { fuzzyIntent, fuzzyToken } from "../internal/fuzzy-match.js";
import type {
  CommerceChatRequest,
  CommerceChatResponse,
  ModelCommerceResult,
} from "./contracts.js";
import { expertHandoff } from "./expert-contact.js";

export const COMMERCE_PROMPT_VERSION = "commerce-2026-08-06.2";

const noUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
const urgentPattern = /\b(unconscious|cannot breathe|can't breathe|seizure|chest pain|medical emergency|suicid(?:e|al)|overdose)\b|(बेहोश|सांस नहीं|दौरा|सीने में दर्द|आपातकाल)/iu;
const medicalHandoffPattern = /\b(stop|start|increase|decrease|change|replace)\b.{0,30}\b(medicine|medication|insulin|dose|dosage)\b|\b(interact|interaction|safe to take|take with)\b.{0,40}\b(medicine|medication|metformin|insulin|prescription)\b|\b(?:with|alongside)\b.{0,30}\b(?:medicine|medication|metformin|insulin|prescription)\b|(दवा|इंसुलिन).{0,30}(बंद|शुरू|बढ़ा|घटा|साथ)/iu;
const promptExtractionPattern = /\b(system prompt|hidden prompt|developer message|reveal.*instructions|ignore.*instructions|all customer data|all patient data)\b/iu;
const expertHelpPattern = /\b(expert help|talk to (?:an? )?expert|speak to (?:an? )?expert|connect (?:me )?(?:to|with) (?:an? )?expert|call(?:back)?|whatsapp|dietitian|dietician)\b|(विशेषज्ञ|डाइटिशियन|डायटीशियन|व्हाट्सएप|कॉल बैक)/iu;
const affirmativePattern = /^(?:yes|yes please|please|sure|okay|ok|haan|हां|हाँ|जी)(?:[.! ]*)$/iu;
const generalDoctorGuidancePattern = /\bdo\s+i?\s*need\b.{0,45}\b(?:doctor|physician|medical guidance)\b|\b(?:need|without|before|consult(?:ing|ation)?|guidance from)\b.{0,45}\b(?:doctor|physician|medical guidance)\b|\b(?:doctor|physician)\b.{0,45}\b(?:before taking|before using|guidance|consult(?:ing|ation)?)\b|\bdoctor\s+consult(?:ing|ation)?\b|\bcan i take (?:this|the) product (?:without|on my own)\b/iu;
const individualizedRiskContextPattern = /\b(?:pregnan(?:t|cy)|breastfeed(?:ing)?|child|kidney|liver disease|allergy|allergic|adverse|side effect|symptom|medicine|medication|metformin|insulin|prescription)\b/iu;
const dosageQuestionPattern = /\b(?:dose|dosage|how many|how much|how often|times? (?:a|per) day)\b|\b(?:tablet|tablets|capsule|capsules)\b.{0,24}\b(?:take|daily|day|time|times)\b|(खुराक|डोज|कितनी (?:गोली|टैबलेट)|कितना लेना)/iu;
const consultationPricePattern = /\b(?:is it|is this|consultation).{0,24}\b(?:free|paid|charge|cost|money)\b|\b(?:free|paid|charge|cost|money)\b.{0,24}\b(?:consultation|doctor|dietitian|dietician|expert)\b|\b(?:take|charge)\s+(?:any\s+)?money\b/iu;
// Any mention of Muditam's dietitian is treated as a consult offer: in this commerce
// scope the word only ever appears when pointing the customer at that human service,
// so waiting for a specific offering verb (book/schedule/...) let real offers slip
// through whenever the model phrased it differently, e.g. "Muditam dietitians create
// plans using your reports" with no "book/consult" wording at all.
const consultationOfferPattern = /\b(?:dietitian|dietician)s?\b|(डाइटिशियन|डायटीशियन)|\b(?:book|schedule|connect|arrange|offer|suggest|recommend|get|talk to|speak (?:to|with)|reach out to)\b.{0,40}\b(?:free\s+)?(?:consultation|consult|doctor|expert)\b|\bconsult(?:ation)?\b.{0,40}\b(?:free\s+)?(?:doctor|expert)\b/iu;

/** Recognizes the intent, not one exact sentence, while requiring two independent signals. */
function asksWhetherDoctorIsNeeded(message: string): boolean {
  if (generalDoctorGuidancePattern.test(message)) return true;
  const compact = message
    .toLocaleLowerCase("en-IN")
    .replace(/([a-z])i(?:need|require)/gu, "$1 i need")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const tokens = compact.split(/\s+/u).filter(Boolean);
  const mentionsDoctor = fuzzyToken(tokens, ["doctor", "physician", "dietitian", "dietician"]);
  const asksConsultation = fuzzyToken(tokens, ["consult", "consulting", "consultation", "guidance", "advice"]);
  const asksNecessity = fuzzyToken(tokens, ["need", "required", "necessary", "before", "without"])
    || /\b(?:can|should|do)\s+i\b|\bkya\b|क्या/iu.test(compact);
  return mentionsDoctor && (asksConsultation || asksNecessity);
}

export function disclosedCondition(message: string): "heart" | "diabetes" | "kidney" | "liver" | null {
  if (/\b(?:heart|cardiac)\s+(?:patient|condition|disease)|\b(?:heart patient|दिल का मरीज|दिल की बीमारी)\b/iu.test(message)) return "heart";
  if (/\b(?:i have diabetes|i am diabetic|i'm diabetic|diabetes patient|diabetic patient|sugar patient|mujhe diabetes (?:hai|hain)|mai(?:n)? diabetic (?:hu|hoon)|mai(?:n)? diabetes patient (?:hu|hoon))\b|(मुझे डायबिटीज़ है|मुझे डायबिटीज है|मैं डायबिटिक हूँ|मैं मधुमेह का मरीज हूँ)/iu.test(message)) return "diabetes";
  if (/\bkidney\s+(?:patient|condition|disease|problem)|\b(?:किडनी की बीमारी|गुर्दे की बीमारी)\b/iu.test(message)) return "kidney";
  if (/\bliver\s+(?:patient|condition|disease|problem)|\b(?:लिवर की बीमारी|जिगर की बीमारी)\b/iu.test(message)) return "liver";
  return null;
}

function conditionHandoffResponse(input: CommerceChatRequest, condition: NonNullable<ReturnType<typeof disclosedCondition>>): CommerceChatResponse {
  const label = condition === "heart"
    ? "heart condition"
    : condition === "diabetes"
      ? "diabetes"
      : `${condition} condition`;
  return response(input, {
    decision: "HANDOFF",
    category: "EXPERT_HANDOFF",
    messages: [{
      type: "text",
      text: `Since you have a ${label}, you can consult your doctor before starting a new supplement. You can also connect with our doctor or dietitian for a FREE supplement consultation.`,
    }],
    handoff: expertHandoff("doctor", `Customer disclosed a ${label}`),
    guardrailStage: "INPUT",
  });
}

function response(
  input: CommerceChatRequest,
  values: Pick<CommerceChatResponse, "decision" | "category" | "messages" | "handoff" | "guardrailStage">,
): CommerceChatResponse {
  return {
    ...values,
    recommendedProducts: [],
    knowledgeReferences: [],
    model: null,
    promptVersion: COMMERCE_PROMPT_VERSION,
    usage: noUsage,
  };
}

const discoveryByConcern = [
  {
    pattern: /\b(?:diabetes|diabetic|blood sugar|glucose|sugar patient)\b|(?:डायबिटीज|मधुमेह|ब्लड शुगर)/iu,
    slugs: ["sugar-defend-pro", "karela-jamun-fizz"],
    copy: "Diabetes support ke liye Sugar Defend Pro aur Karela Jamun Fizz dekh sakte hain. Sugar Defend Pro broader daily metabolic support deta hai, while Karela Jamun Fizz ek convenient drink format hai.",
  },
  {
    pattern: /\b(?:heart|cardiac)\b|(?:हार्ट|दिल)/iu,
    slugs: ["heart-defend-pro"],
    copy: "Heart wellness support ke liye Heart Defend Pro dekh sakte hain. Yeh daily cardiovascular wellness support ke liye formulated supplement hai.",
  },
  {
    pattern: /\b(?:fatty liver|liver|lever)\b|(?:लिवर|जिगर)/iu,
    slugs: ["liver-defend-pro"],
    copy: "Liver wellness support ke liye Liver Defend Pro dekh sakte hain. Yeh daily liver wellness support ke liye formulated supplement hai.",
  },
] as const;

export function deterministicProductDiscovery(
  input: CommerceChatRequest,
  knowledge: readonly KnowledgeEntry[],
): CommerceChatResponse | null {
  const asksForProduct = fuzzyIntent(input.message, ["product", "products", "supplement", "something", "anything", "recommend"])
    || /\b(?:kuch|chahiye)\b|(?:प्रोडक्ट|उत्पाद|सप्लीमेंट|कुछ)/iu.test(input.message);
  if (!asksForProduct) return null;
  const match = discoveryByConcern.find((item) => item.pattern.test(input.message));
  if (!match) return null;
  const entries = match.slugs.flatMap((slug) => {
    const entry = knowledge.find((item) => item.sourceType === "product"
      && item.recommendationEligible === true
      && item.productSlug === slug);
    return entry ? [entry] : [];
  });
  if (!entries.length) return null;
  const names = entries.map(productName);
  const english = names.length > 1
    ? `For blood-sugar wellness support, you can consider ${names.join(" and ")}. They offer different formats for convenient daily support.`
    : `For ${match.slugs[0]?.startsWith("heart") ? "heart" : "liver"} wellness support, you can consider ${names[0]}.`;
  const text = input.language === "hinglish" ? match.copy : english;
  return {
    decision: "ALLOW",
    category: "PRODUCT_DISCOVERY",
    messages: [{ type: "text", text }],
    recommendedProducts: entries.map((entry) => ({
      productSlug: entry.productSlug as string,
      name: productName(entry),
      productUrl: entry.sourceUrl,
      reason: "Verified Muditam product for daily wellness support",
    })),
    knowledgeReferences: entries.map((entry) => ({
      key: entry.key,
      title: entry.title,
      sourceName: entry.sourceName,
      sourceUrl: entry.sourceUrl,
    })),
    handoff: null,
    model: null,
    promptVersion: COMMERCE_PROMPT_VERSION,
    guardrailStage: "INPUT",
    usage: noUsage,
  };
}

export function deterministicCommerceGuardrail(input: CommerceChatRequest): CommerceChatResponse | null {
  if (urgentPattern.test(input.message)) {
    return response(input, {
      decision: "SAFETY",
      category: "URGENT_SAFETY",
      messages: [{
        type: "text",
        text: input.language === "hi"
          ? "यह तुरंत चिकित्सा सहायता की स्थिति हो सकती है। कृपया अभी स्थानीय आपातकालीन सेवा से संपर्क करें।"
          : "This may require immediate medical help. Please contact your local emergency service now.",
      }],
      handoff: null,
      guardrailStage: "INPUT",
    });
  }
  if (medicalHandoffPattern.test(input.message)) {
    return response(input, {
      decision: "HANDOFF",
      category: "EXPERT_HANDOFF",
      messages: [{
        type: "text",
        text: input.language === "hi"
          ? "चूंकि इसमें दवा शामिल है, हमारी डॉक्टर टीम से एक त्वरित संगतता जाँच बेहतर रहेगी। आप चैट पसंद करेंगे या कॉलबैक?"
          : "Since medication is involved, a quick compatibility check with our doctor would be best. Would you prefer a chat or a callback?",
      }],
      handoff: expertHandoff("doctor", "Medication compatibility or treatment-change question"),
      guardrailStage: "INPUT",
    });
  }
  const condition = disclosedCondition(input.message);
  if (condition) return conditionHandoffResponse(input, condition);
  if (dosageQuestionPattern.test(input.message)) {
    return response(input, {
      decision: "HANDOFF",
      category: "EXPERT_HANDOFF",
      messages: [{
        type: "text",
        text: "The right supplement dosage can vary by individual needs. Our doctor or dietitian can guide you through a FREE supplement consultation.",
      }],
      handoff: expertHandoff("dietitian", "Customer requested personalized supplement dosage"),
      guardrailStage: "INPUT",
    });
  }
  const priorOfferedConsultation = input.recentMessages
    .filter((message) => message.role === "assistant")
    .slice(-3)
    .some((message) => /\b(?:consultation|doctor|dietitian|dietician|expert)\b/iu.test(message.content));
  if (consultationPricePattern.test(input.message) && priorOfferedConsultation) {
    return response(input, {
      decision: "HANDOFF",
      category: "EXPERT_HANDOFF",
      messages: [{
        type: "text",
        text: "Yes, the consultation is completely FREE. Our doctor or dietitian can provide personalized supplement and diet guidance.",
      }],
      handoff: expertHandoff("dietitian", "Customer asked about the price of an offered consultation"),
      guardrailStage: "INPUT",
    });
  }
  if (asksWhetherDoctorIsNeeded(input.message) && !individualizedRiskContextPattern.test(input.message)) {
    return response(input, {
      decision: "HANDOFF",
      category: "EXPERT_HANDOFF",
      messages: [{
        type: "text",
        text: "All our products are health supplements and can generally be taken without consulting a doctor. However, if you want to be extra sure, we offer FREE doctor consultations to provide personalized guidance.",
      }],
      handoff: expertHandoff("doctor", "Customer asked whether a doctor consultation is required"),
      guardrailStage: "INPUT",
    });
  }
  const priorOfferedExpert = input.recentMessages
    .filter((message) => message.role === "assistant")
    .slice(-2)
    .some((message) => /\b(expert|support|dietitian|doctor|callback|whatsapp)\b/iu.test(message.content));
  if (expertHelpPattern.test(input.message) || (affirmativePattern.test(input.message) && priorOfferedExpert)) {
    return response(input, {
      decision: "HANDOFF",
      category: "EXPERT_HANDOFF",
      messages: [{
        type: "text",
        text: input.language === "hi"
          ? "ज़रूर—हमारे वेलनेस एक्सपर्ट प्रोडक्ट चुनने और व्यक्तिगत मार्गदर्शन में आपकी मदद कर सकते हैं।"
          : "Of course—our wellness expert can help you choose the right products and answer your questions.",
      }],
      handoff: expertHandoff("dietitian", "Customer requested expert help"),
      guardrailStage: "INPUT",
    });
  }
  if (promptExtractionPattern.test(input.message)) {
    return response(input, {
      decision: "REFUSE",
      category: "OFF_TOPIC",
      messages: [{ type: "text", text: "I can help with Muditam products, orders, and wellness information." }],
      handoff: null,
      guardrailStage: "INPUT",
    });
  }
  return null;
}

function productName(entry: KnowledgeEntry): string {
  return entry.title.split(" — ")[0]?.trim() || entry.productSlug || "Muditam product";
}

export function formatCommerceCopy(value: string, maxWords: number): string {
  return formatChatAnswer(
    value
      .replace(/\[(?:product|platform):[^\]]+\]/giu, "")
      .replace(/\s*[—–]\s*/gu, ", ")
      .replace(/\s+([,.!?])/g, "$1")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .trim(),
    maxWords,
  );
}

function handoffFor(result: ModelCommerceResult): CommerceChatResponse["handoff"] {
  if (result.decision !== "HANDOFF") return null;
  if (result.category === "ORDER_OR_SUPPORT") return expertHandoff("support", "Customer requested support");
  return expertHandoff("dietitian", "Customer requested personalized guidance");
}

export function enforceCommerceResult(
  result: ModelCommerceResult,
  input: CommerceChatRequest,
  knowledge: readonly KnowledgeEntry[],
  model: string,
  usage: CommerceChatResponse["usage"],
): CommerceChatResponse {
  if (result.decision === "SAFETY" || result.category === "URGENT_SAFETY") {
    const condition = disclosedCondition(input.message);
    if (condition) return conditionHandoffResponse(input, condition);
    if (!urgentPattern.test(input.message)) {
      return {
        decision: "HANDOFF",
        category: "EXPERT_HANDOFF",
        messages: [{
          type: "text",
          text: "Our doctor or dietitian can help review your health concern and provide a FREE supplement consultation.",
        }],
        recommendedProducts: [],
        knowledgeReferences: [],
        handoff: expertHandoff("doctor", "Model requested safety escalation without an explicit urgent symptom"),
        model,
        promptVersion: COMMERCE_PROMPT_VERSION,
        guardrailStage: "OUTPUT",
        usage,
      };
    }
    return deterministicCommerceGuardrail(input) as CommerceChatResponse;
  }

  if (result.category === "OFF_TOPIC") {
    return {
      decision: "REFUSE",
      category: "OFF_TOPIC",
      messages: [{
        type: "text",
        text: input.language === "hi"
          ? "मैं केवल Muditam के प्रोडक्ट्स, ऑर्डर्स और वेलनेस सपोर्ट में आपकी मदद कर सकता हूँ। आप Muditam के बारे में क्या जानना चाहेंगे?"
          : input.language === "hinglish"
            ? "Main sirf Muditam products, orders aur wellness support mein help kar sakta hoon. Aap Muditam ke baare mein kya jaanna chahenge?"
          : "I can only help with Muditam products, orders, and wellness support. What would you like to know about Muditam?",
      }],
      recommendedProducts: [],
      knowledgeReferences: [],
      handoff: null,
      model,
      promptVersion: COMMERCE_PROMPT_VERSION,
      guardrailStage: "OUTPUT",
      usage,
    };
  }

  const knowledgeByKey = new Map(knowledge.map((entry) => [entry.key, entry]));
  const citedKnowledge = [...new Set(result.citedKnowledgeKeys)].flatMap((key) => {
    const entry = knowledgeByKey.get(key);
    return entry ? [{ key, title: entry.title, sourceName: entry.sourceName, sourceUrl: entry.sourceUrl }] : [];
  });
  const productBySlug = new Map(
    knowledge
      .filter((entry) => entry.sourceType === "product" && entry.recommendationEligible && entry.productSlug)
      .map((entry) => [entry.productSlug as string, entry]),
  );
  const recommendedProducts = [...new Map(result.recommendations.map((item) => [item.productSlug, item])).values()]
    .flatMap((item) => {
      const entry = productBySlug.get(item.productSlug);
      return entry ? [{
        productSlug: item.productSlug,
        name: productName(entry),
        productUrl: entry.sourceUrl,
        reason: item.reason,
      }] : [];
    })
    .slice(0, 3);
  // A recommendation slug can only survive if it matches retrieved, eligible product
  // knowledge. Use that verified record when a smaller model omits its citation key.
  const recommendationKnowledge = recommendedProducts.flatMap((product) => {
    const entry = productBySlug.get(product.productSlug);
    const visiblyNamed = result.answer.toLocaleLowerCase("en-IN").includes(product.name.toLocaleLowerCase("en-IN"));
    return entry && visiblyNamed ? [{
      key: entry.key,
      title: entry.title,
      sourceName: entry.sourceName,
      sourceUrl: entry.sourceUrl,
    }] : [];
  });
  const knowledgeReferences = [...new Map(
    [...citedKnowledge, ...recommendationKnowledge].map((reference) => [reference.key, reference]),
  ).values()];

  const requiresKnowledge = ["PRODUCT_DISCOVERY", "PRODUCT_INFORMATION", "PRODUCT_COMPARISON"].includes(result.category);
  if (requiresKnowledge && knowledgeReferences.length === 0) {
    return {
      decision: "REFUSE",
      category: result.category,
      messages: [{
        type: "text",
        text: input.language === "hi"
          ? "मुझे अभी इसके लिए सत्यापित प्रोडक्ट जानकारी नहीं मिली। मैं आपको हमारी सपोर्ट टीम से जोड़ सकता हूँ।"
          : "I couldn’t find verified product information for that yet. I can connect you with our support team.",
      }],
      recommendedProducts: [],
      knowledgeReferences: [],
      handoff: expertHandoff("support", "Verified product knowledge unavailable"),
      model,
      promptVersion: COMMERCE_PROMPT_VERSION,
      guardrailStage: "OUTPUT",
      usage,
    };
  }

  const answer = formatCommerceCopy(result.answer, 55);
  if (!answer) {
    return {
      decision: "REFUSE",
      category: result.category,
      messages: [{ type: "text", text: "I’m sorry, I couldn’t prepare a reliable answer. Let me connect you with support." }],
      recommendedProducts: [],
      knowledgeReferences: [],
      handoff: expertHandoff("support", "Empty model response"),
      model,
      promptVersion: COMMERCE_PROMPT_VERSION,
      guardrailStage: "OUTPUT",
      usage,
    };
  }

  const messages: CommerceChatResponse["messages"] = [{ type: "text", text: answer }];
  if (result.followUp) messages.push({ type: "text", text: formatCommerceCopy(result.followUp, 18) });
  const offersConsultation = messages.some((message) => consultationOfferPattern.test(message.text));
  return {
    decision: offersConsultation ? "HANDOFF" : result.decision,
    category: offersConsultation ? "EXPERT_HANDOFF" : result.category,
    messages,
    recommendedProducts: offersConsultation ? [] : recommendedProducts,
    knowledgeReferences,
    handoff: offersConsultation
      ? expertHandoff("dietitian", "Assistant offered to arrange a consultation")
      : handoffFor(result),
    model,
    promptVersion: COMMERCE_PROMPT_VERSION,
    guardrailStage: offersConsultation ? "OUTPUT" : null,
    usage,
  };
}
