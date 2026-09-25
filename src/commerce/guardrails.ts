import type { KnowledgeEntry } from "../chat/knowledge.js";
import { formatChatAnswer } from "../chat/guardrails.js";
import { editDistance, fuzzyIntent, fuzzyToken } from "../internal/fuzzy-match.js";
import type {
  CommerceChatRequest,
  CommerceChatResponse,
  ModelCommerceResult,
} from "./contracts.js";
import { expertHandoff } from "./expert-contact.js";

export const COMMERCE_PROMPT_VERSION = "commerce-2026-08-06.2";

const noUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
const urgentPattern = /\b(unconscious|cannot breathe|can't breathe|seizure|chest pain|medical emergency|suicid(?:e|al)|overdose)\b|(बेहोश|सांस नहीं|दौरा|सीने में दर्द|आपातकाल)/iu;
const medicalHandoffPattern = /\b(stop|start|increase|decrease|change|replace)\b.{0,30}\b(medicine|medication|insulin|dose|dosage)\b|\b(interact|interaction|safe to take|take with)\b.{0,40}\b(medicine|medication|metformin|insulin|prescription)\b|\b(?:with|alongside)\b.{0,30}\b(?:medicine|medication|metformin|insulin|prescription)\b|\b(?:insulin|metformin|medicine|medication|prescription)\b.{0,45}\b(?:le raha|le rahi|leta|leti|le rahe|taking|take)\b|\b(?:le raha|le rahi|leta|leti|le rahe|taking|take)\b.{0,45}\b(?:insulin|metformin|medicine|medication|prescription)\b|(दवा|इंसुलिन).{0,30}(बंद|शुरू|बढ़ा|घटा|साथ)/iu;
const promptExtractionPattern = /\b(system prompt|hidden prompt|developer message|reveal.*instructions|ignore.*instructions|all customer data|all patient data)\b/iu;
const expertHelpPattern = /\b(expert help|talk to (?:an? )?expert|speak to (?:an? )?expert|connect (?:me )?(?:to|with) (?:an? )?expert|call(?:back)?|whatsapp|dietitian|dietician)\b|(विशेषज्ञ|डाइटिशियन|डायटीशियन|व्हाट्सएप|कॉल बैक)/iu;
const affirmativePattern = /^(?:yes|yes please|please|sure|okay|ok|haan|हां|हाँ|जी)(?:[.! ]*)$/iu;
const generalDoctorGuidancePattern = /\bdo\s+i?\s*need\b.{0,45}\b(?:doctor|physician|medical guidance)\b|\b(?:need|without|before|consult(?:ing|ation)?|guidance from)\b.{0,45}\b(?:doctor|physician|medical guidance)\b|\b(?:doctor|physician)\b.{0,45}\b(?:before taking|before using|guidance|consult(?:ing|ation)?)\b|\bdoctor\s+consult(?:ing|ation)?\b|\bcan i take (?:this|the) product (?:without|on my own)\b/iu;
const genericAllopathicMedicationQuestionPattern = /\bcan i take\b.{0,80}\bwith (?:my |any |the )?(?:allopathic )?(?:medicine|medication|medicines|medications)\b|\b(?:allopathic )?(?:medicine|medication|medicines|medications)\b.{0,80}\b(?:ke saath|with)\b.{0,40}\b(?:le sakta|le sakti|take|lena)\b/iu;
const namedHighRiskMedicinePattern = /\b(?:insulin|metformin|prescription|blood thinner|warfarin|bp medicine|thyroid medicine)\b|(?:इंसुलिन|मेटफॉर्मिन|दवा की पर्ची)/iu;
const individualizedRiskContextPattern = /\b(?:pregnan(?:t|cy)|breastfeed(?:ing)?|child|kidney|liver disease|allergy|allergic|adverse|side effect|symptom|medicine|medication|metformin|insulin|prescription)\b/iu;
const dosageQuestionPattern = /\b(?:dose|dosage|how many|how much|how often|times? (?:a|per) day|kitni baar|kitna lena|kaise lena)\b|\b(?:tablet|tablets|capsule|capsules)\b.{0,24}\b(?:take|daily|day|time|times)\b|(खुराक|डोज|कितनी (?:गोली|टैबलेट)|कितना लेना)/iu;
const priceQuestionPattern = /\b(?:price|cost|mrp|offer price|how much (?:is|does)|kitne ka|kitni price|daam)\b|(?:कीमत|दाम)/iu;
const cheapestProductPattern = /\b(?:cheapest|lowest[ -]?priced|least expensive|most affordable|budget(?:-friendly)?)\b/iu;
const variantQuestionPattern = /\b(?:quantity|quantities|pack|packs|set|sets|variant|variants|pack options?|purchase options?|size|sizes|bottles?|boxes?|sachets?)\b|(?:कितनी बोतल|पैक|सेट)/iu;
const unitQuantityQuestionPattern = /\b(?:how many|quantity|count)\b.{0,35}\b(?:tablets?|capsules?|sachets?|softgels?|sprays?)\b|\b(?:tablets?|capsules?|sachets?|softgels?|sprays?)\b.{0,35}\b(?:per|each|in (?:a|one|each)|bottle|box|pack)\b|(?:कितनी (?:गोली|टैबलेट|कैप्सूल|सैशे))/iu;
const shelfLifeQuestionPattern = /\b(?:shelf[ -]?life|expiry|expires?|expiration|best before)\b|(?:शेल्फ लाइफ|एक्सपायरी)/iu;
const completeProductDetailsPattern = /\b(?:all|complete|full|every(?:thing)?)\b.{0,25}\b(?:details?|information|info)\b|\b(?:details?|information|info)\b.{0,25}\b(?:all|complete|full|every(?:thing)?)\b/iu;
const certificationQuestionPattern = /\b(?:certif(?:ied|icate|ication)|approv(?:ed|al)|fda|usfda|who[ -]?gmp|gmp|fssai|haccp|halal|iso)\b/iu;
const consultationPricePattern = /\b(?:is it|is this|consultation).{0,24}\b(?:free|paid|charge|cost|money)\b|\b(?:free|paid|charge|cost|money)\b.{0,24}\b(?:consultation|doctor|dietitian|dietician|expert)\b|\b(?:take|charge)\s+(?:any\s+)?money\b/iu;
const refundRequestPattern = /\b(?:i (?:need|want|would like|require)(?: a| my)? refund|refund (?:my|this|the|an?)?\s*(?:order|purchase|product)?|money back|return (?:my|this|the) (?:order|purchase|product))\b|(?:रिफंड|पैसे वापस)/iu;
const pregnancyOrBreastfeedingPattern = /\b(?:pregnan(?:t|cy)|pregnacy|pregnency|pregnent|breastfeed(?:ing)?|nursing mother|trying to conceive|conceiv(?:e|ing))\b|(?:गर्भवती|गर्भावस्था|स्तनपान)/iu;
const genericSideEffectQuestionPattern = /(?:^|\b)(?:is|are|any|what|does|do|have|has|known)?\s*(?:there\s+)?(?:any\s+)?side[ -]?effects?\b|\bside[ -]?effects?\s*(?:hai|hain|hote|hotey|kya|\?)|(?:साइड इफेक्ट|दुष्प्रभाव)/iu;
const addToCartCapabilityPattern = /\b(?:can|could|will|would)\s+you\b.{0,35}\b(?:add|put)\b.{0,20}\b(?:cart|basket)\b|\b(?:add|put)\b.{0,20}\b(?:product|item|it|this)\b.{0,20}\b(?:cart|basket)\b.{0,15}\b(?:for me|yourself)|(?:कार्ट में जोड़)/iu;
const claimedIngredientCountPattern = /\b(?:exactly\s+)?(\d{1,3})\s+(?:total\s+)?ingredients?\b/iu;
const founderQuestionPattern = /\b(?:who\s+(?:is|are)\s+(?:the\s+)?(?:founder|co[ -]?founder)s?(?:\s+of\s+muditam)?|who\s+founded\s+muditam|is\s+.{1,45}\s+(?:the\s+)?(?:founder|co[ -]?founder)(?:\s+of\s+muditam)?|(?:founder|co[ -]?founder)s?\s+(?:of\s+)?muditam|(?:founder|co[ -]?founder)\s+(?:kaun|kon)(?:\s+hai)?)\b|(?:संस्थापक|फाउंडर)/iu;
const vaguePersonalRecommendationPattern = /\b(?:which|what|konsa|kaunsa|konsi|kaunsi)\b.{0,35}\b(?:product|supplement)\b.{0,25}\b(?:for me|mere liye|mujhe|sahi|right|best|take)\b|\b(?:mere liye|mujhe)\b.{0,35}\b(?:which|what|konsa|kaunsa|konsi|kaunsi|product|supplement|sahi|best)\b|\bwhat should i take\b|(?:मेरे लिए कौनसा|मेरे लिए कौन सा|मुझे कौनसा)/iu;
const explicitWellnessGoalPattern = /\b(?:diabetes|diabetic|blood sugar|glucose|liver|fatty liver|heart|cardiac|thyroid|gut|digestion|digestive|constipation|constipated|constapation|bloating|gas|acidity|nerve|neuropathy|bone|calcium|sleep|insomnia|stress|energy|stamina|men'?s wellness|weight)\b|(?:डायबिटीज|शुगर|लिवर|हार्ट|थायराइड|पेट|पाचन|कब्ज|गैस|नींद|हड्डी|नस)/iu;
const clearlyOffTopicPattern = /\b(?:should i (?:bathe|shower)|take a (?:bath|shower)|weather|forecast|cricket|football|match score|stock market|share price|write (?:javascript|python|code)|coding|programming|tell me a joke|movie|song|lyrics|recipe|cook(?:ing)?|homework|politics|election|celebrity|horoscope|astrology)\b|\b(?:naha(?:na|ne|u|oon)|nahau|nahaaun|baarish|mausam|cricket|joke|gaana|film|recipe|khana kaise bana|राजनीति|मौसम|नहाने|नहाऊँ|क्रिकेट|चुटकुला)\b/iu;
const currentMessageScopeSignalPattern = /\b(?:muditam|product|products|supplement|order|delivery|tracking|refund|return|cancel|price|cost|dosage|dose|ingredient|tablet|capsule|sachet|doctor|dietitian|dietician|support|wellness|health|diabetes|blood sugar|liver|heart|thyroid|gut|digestion|constipation|sleep|bone|nerve|medicine|medication|pregnan(?:t|cy)|breastfeed(?:ing)?|side[ -]?effect)\b|(?:प्रोडक्ट|सप्लीमेंट|ऑर्डर|डिलीवरी|कीमत|खुराक|डॉक्टर|डाइटिशियन|स्वास्थ्य|डायबिटीज|लिवर|हार्ट|पेट|नींद)/iu;
// Any mention of Muditam's dietitian is treated as a consult offer: in this commerce
// scope the word only ever appears when pointing the customer at that human service,
// so waiting for a specific offering verb (book/schedule/...) let real offers slip
// through whenever the model phrased it differently, e.g. "Muditam dietitians create
// plans using your reports" with no "book/consult" wording at all.
const consultationOfferPattern = /\b(?:dietitian|dietician)s?\b|(डाइटिशियन|डायटीशियन)|\b(?:book|schedule|connect|arrange|offer|suggest|recommend|get|talk to|speak (?:to|with)|reach out to)\b.{0,40}\b(?:free\s+)?(?:consultation|consult|doctor|expert)\b|\bconsult(?:ation)?\b.{0,40}\b(?:free\s+)?(?:doctor|expert)\b/iu;

function likelyInScopeSupportRequest(message: string): boolean {
  return fuzzyIntent(message, ["product", "products", "supplement", "recommend", "order", "refund", "delivery", "price", "dosage", "ingredient", "ingredients"])
    || /\b(?:wellness|health concern|blood sugar|diabetes|liver|heart|thyroid|gut|sleep|bone|nerve|symptom|muditam)\b/iu.test(message);
}

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
      text: input.language === "hi"
        ? `चूंकि आपको ${condition === "diabetes" ? "डायबिटीज" : condition === "heart" ? "हृदय संबंधी समस्या" : `${condition} संबंधी समस्या`} है, नया सप्लीमेंट शुरू करने से पहले आप अपने डॉक्टर से सलाह ले सकते हैं। मुफ़्त सप्लीमेंट मार्गदर्शन के लिए आप हमारे डॉक्टर या डाइटिशियन से भी जुड़ सकते हैं।`
        : input.language === "hinglish"
          ? `Aapko ${condition === "diabetes" ? "diabetes" : `${condition} condition`} hai, isliye naya supplement shuru karne se pehle aap apne doctor se consult kar sakte hain. FREE supplement guidance ke liye aap hamare doctor ya dietitian se bhi connect kar sakte hain.`
          : `Since you have ${condition === "diabetes" ? "diabetes" : `a ${label}`}, you can consult your doctor before starting a new supplement. You can also connect with our doctor or dietitian for a FREE supplement consultation.`,
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
    key: "blood_sugar",
    pattern: /\b(?:diabetes|diabetic|blood sugar|glucose|sugar patient)\b|(?:डायबिटीज|मधुमेह|ब्लड शुगर)/iu,
  },
  {
    key: "heart",
    pattern: /\b(?:heart|cardiac)\b|(?:हार्ट|दिल)/iu,
  },
  {
    key: "liver",
    pattern: /\b(?:fatty liver|liver|lever)\b|(?:लिवर|जिगर)/iu,
  },
  {
    key: "gut",
    pattern: /\b(?:constipation|constipated|constapation|weak digestion|poor digestion|digestion|digestive|gut health|gut|bloating|gas|acidity)\b|(?:कब्ज|पेट|पाचन|गैस)/iu,
  },
  {
    key: "bone",
    pattern: /\b(?:bone|bones|bone health|calcium|joint support)\b|(?:हड्डी|हड्डियों|कैल्शियम)/iu,
  },
] as const;

function entryMatchesConcern(entry: KnowledgeEntry, concern: typeof discoveryByConcern[number]["key"]): boolean {
  if (entry.recommendationConcern === concern) return true;
  const haystack = normalizedWords([
    entry.productSlug,
    productName(entry),
    entry.content,
    entry.keywords.join(" "),
  ].filter(Boolean).join(" "));
  const has = (pattern: RegExp) => pattern.test(haystack);
  if (concern === "blood_sugar") return has(/\b(?:diabetes|diabetic|blood sugar|glucose|sugar|karela jamun|sugar defend|berberine|vasant kusmakar)\b/u);
  if (concern === "liver") return has(/\b(?:liver|fatty liver|liver fix|liver defend|milk thistle|kutaki)\b/u);
  if (concern === "heart") return has(/\b(?:heart|cardiac|cardiovascular|omega|heart defend)\b/u);
  if (concern === "gut") return has(/\b(?:gut|digestion|digestive|constipation|bloating|gas|acidity|power gut)\b/u);
  if (concern === "bone") return has(/\b(?:bone|calcium|joint|bone dense)\b/u);
  return false;
}

export function deterministicProductDiscovery(
  input: CommerceChatRequest,
  knowledge: readonly KnowledgeEntry[],
): CommerceChatResponse | null {
  const recentUserContext = input.recentMessages
    .filter((message) => message.role === "user")
    .slice(-3)
    .map((message) => message.content)
    .join(" ");
  const productIntentContext = `${recentUserContext} ${input.message}`;
  const currentMatch = discoveryByConcern.find((item) => item.pattern.test(input.message));
  const normalizedCurrentMessage = ` ${normalizedWords(input.message)} `;
  const namesKnownProduct = knowledge.some((entry) => entry.sourceType === "product"
    && productReferenceMatches(normalizedCurrentMessage, productName(entry)));
  if (namesKnownProduct) return null;
  const asksForProduct = fuzzyIntent(productIntentContext, ["product", "products", "supplement", "something", "anything", "recommend"])
    || /\b(?:kuch|chahiye)\b|(?:प्रोडक्ट|उत्पाद|सप्लीमेंट|कुछ)/iu.test(productIntentContext)
    // Short concern turns such as "for diabetes?" and "aur liver ke liye"
    // are natural requests for category recommendations in this storefront.
    // Resolve them deterministically so the model can never invent products.
    || (currentMatch !== undefined && !namesKnownProduct)
    // A stable condition disclosure communicates the customer's wellness goal.
    // It should enter configured product discovery unless the same message asks
    // about medication, dosage, pregnancy, side effects, or medical suitability.
    || disclosedCondition(input.message) !== null;
  if (!asksForProduct) return null;
  const contextualFollowUp = /\b(?:for (?:this|that|it)|recommend|product|supplement|iske liye|uske liye|is ke liye|koi|kuch)\b|(?:इसके लिए|उसके लिए|कोई प्रोडक्ट)/iu.test(input.message);
  const match = currentMatch ?? (contextualFollowUp
    ? discoveryByConcern.find((item) => item.pattern.test(recentUserContext))
    : undefined);
  if (!match) return null;
  let entries = [...new Map(knowledge
    .filter((item) => item.sourceType === "product"
      && item.recommendationEligible === true
      && item.productSlug
      && entryMatchesConcern(item, match.key))
    .map((item) => [item.productSlug as string, item])).values()]
    .sort((left, right) => (left.tagRank ?? Number.MAX_SAFE_INTEGER) - (right.tagRank ?? Number.MAX_SAFE_INTEGER)
      || (left.overallRank ?? Number.MAX_SAFE_INTEGER) - (right.overallRank ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 8);
  const asksForDissolvableFormat = /\b(?:dissolv(?:e|ed|able)|effervescent|in water|drink format|fizz)\b/iu.test(input.message);
  if (asksForDissolvableFormat) {
    const formatMatches = entries.filter((entry) => /\b(?:dissolv(?:e|ed|able)|effervescent|in water|drink format|fizz)\b/iu
      .test(`${productName(entry)} ${entry.content}`)
      || entry.productSlug === "liver-fix");
    if (formatMatches.length) entries = formatMatches;
  }
  if (!entries.length) {
    return response(input, {
      decision: "HANDOFF",
      category: "ORDER_OR_SUPPORT",
      messages: [{
        type: "text",
        text: "I couldn’t find a verified product for that concern. Our support team can help you with the right information.",
      }],
      handoff: expertHandoff("support", "No verified product was available for the requested concern"),
      guardrailStage: "INPUT",
    });
  }
  const names = entries.map(productName);
  const concern = match.key === "blood_sugar" ? "blood-sugar" : match.key;
  const english = names.length > 1
    ? `For ${concern} wellness support, you can consider ${names.join(" and ")}. They offer different options for convenient daily support.`
    : `For ${concern} wellness support, you can consider ${names[0]}.`;
  const text = input.language === "hinglish"
    ? `${concern} wellness support ke liye aap ${names.join(" aur ")} consider kar sakte hain.`
    : english;
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

const bestSellerPattern = /\b(?:best[- ]?sell(?:er|ing)?|top[- ]?sell(?:er|ing)?|most (?:popular|sold|selling))\b|(?:सबसे ज़्यादा बिकने वाला|बेस्ट सेलर)/iu;
const productComparisonPattern = /\b(?:difference|different|compare|comparison|vs|versus|between|b\/?w|better|which (?:is )?(?:better|best))\b|(?:अंतर|तुलना|बेहतर)/iu;

// The overall flagship best seller and the diabetes-category best seller are the
// same product (business-confirmed, not inferred) — this is deliberately a fixed
// fact rather than left to the model, since it has no real sales data to reason
// from and would otherwise guess by topical similarity (e.g. picking Berberine Pro
// just because it's also blood-sugar related).
const BEST_SELLER_SLUG = "karela-jamun-fizz";
const productCataloguePattern = /\b(?:what (?:are|products? (?:do|does)) muditam products?|what products? do (?:you|muditam) (?:have|offer|sell)|show (?:me )?(?:all |your )?products?|all (?:muditam )?products?|(?:your|muditam) product (?:catalogue|catalog))\b/iu;

function productCatalogueIntent(message: string): boolean {
  if (productCataloguePattern.test(message)) return true;
  const hasProduct = fuzzyIntent(message, ["product", "products", "prodcuts", "produts", "catalogue", "catalog"]);
  const hasCatalogueRequest = fuzzyIntent(message, ["what", "show", "list", "all", "catalogue", "catalog"]);
  const identifiesMuditamCatalogue = fuzzyIntent(message, ["muditam"]) || /\b(?:your|aapke|apke)\b/iu.test(message);
  // A short phrase such as "Muditam products?" or "aapke products" already
  // contains both the catalogue owner and subject. Requiring an additional
  // command word (show/list/what) caused these natural queries to fall through
  // to the model and return prose without product cards.
  return hasProduct && identifiesMuditamCatalogue && (hasCatalogueRequest || message.trim().length <= 48);
}

export function deterministicProductCatalogue(
  input: CommerceChatRequest,
  knowledge: readonly KnowledgeEntry[],
): CommerceChatResponse | null {
  if (!productCatalogueIntent(input.message)) return null;
  const entries = [...new Map(knowledge
    .filter((entry) => entry.sourceType === "product" && entry.recommendationEligible === true && entry.productSlug)
    .map((entry) => [entry.productSlug as string, entry])).values()];
  entries.sort((left, right) => (left.overallRank ?? Number.MAX_SAFE_INTEGER) - (right.overallRank ?? Number.MAX_SAFE_INTEGER)
  );
  if (!entries.length) {
    return response(input, {
      decision: "HANDOFF",
      category: "ORDER_OR_SUPPORT",
      messages: [{ type: "text", text: "I couldn’t load the verified Muditam product catalogue. Please connect with our support team for help." }],
      handoff: expertHandoff("support", "Verified product catalogue was unavailable"),
      guardrailStage: "INPUT",
    });
  }
  const bestSeller = entries.find((entry) => entry.productSlug === BEST_SELLER_SLUG);
  const bestSellerName = bestSeller ? productName(bestSeller) : "Karela Jamun Fizz";
  return {
    decision: "ALLOW",
    category: "PRODUCT_DISCOVERY",
    messages: [{
      type: "text",
      text: `Muditam offers wellness products for blood sugar and diabetes support, liver, heart, thyroid, gut health, nerve health, bone health, sleep, daily wellness, and men’s wellness. ${bestSellerName} is our best-selling product. You can browse all Muditam products below. If you need information about a specific product, or want a recommendation for heart, diabetes, liver, or another wellness concern, just tell me.`,
    }],
    recommendedProducts: entries.map((entry) => ({
      productSlug: entry.productSlug as string,
      name: productName(entry),
      productUrl: entry.sourceUrl,
      reason: entry.productSlug === BEST_SELLER_SLUG ? "Muditam's best-selling product" : "Muditam wellness product",
    })),
    knowledgeReferences: entries.map((entry) => ({ key: entry.key, title: entry.title, sourceName: entry.sourceName, sourceUrl: entry.sourceUrl })),
    handoff: null,
    model: null,
    promptVersion: COMMERCE_PROMPT_VERSION,
    guardrailStage: "INPUT",
    usage: noUsage,
  };
}

function approvedProductSummary(entry: KnowledgeEntry): string {
  const text = entry.content;
  const explicit = [
    text.match(/^Approved key benefits:\s*(.+)$/imu)?.[1],
    text.match(/^Approved description:\s*(.+)$/imu)?.[1],
    text.match(/^Published description:\s*(.+)$/imu)?.[1],
    text.match(/^More approved product information:\s*(.+)$/imu)?.[1],
  ].find((value) => value && value.trim().length > 0)?.trim();
  if (explicit) return formatCommerceCopy(explicit, 18).replace(/\.$/u, "");
  const firstContentLine = text
    .split(/\n+/u)
    .map((line) => line.trim())
    .find((line) => line && !/^Product:/iu.test(line));
  return formatCommerceCopy(firstContentLine ?? "daily wellness support", 18).replace(/\.$/u, "");
}

function preferredComparisonEntry(entries: readonly KnowledgeEntry[], slug: string): KnowledgeEntry | null {
  const sameProduct = entries.filter((entry) => entry.productSlug === slug);
  const liveDetails = sameProduct.find((entry) => entry.key.endsWith(":live-shopify-details")
    && /^Approved (?:description|key benefits|concerns):/imu.test(entry.content));
  return liveDetails
    ?? sameProduct.find((entry) => entry.key.endsWith(":overview"))
    ?? sameProduct[0]
    ?? null;
}

export function deterministicProductComparison(
  input: CommerceChatRequest,
  knowledge: readonly KnowledgeEntry[],
): CommerceChatResponse | null {
  if (!productComparisonPattern.test(input.message)) return null;
  const normalizedMessage = ` ${normalizedWords(input.message)} `;
  const messageTokens = normalizedWords(input.message).split(/\s+/u).filter(Boolean);
  const productEntries = [...new Map(knowledge
    .filter((entry) => entry.sourceType === "product"
      && entry.recommendationEligible === true
      && entry.productSlug)
    .map((entry) => [entry.productSlug as string, entry])).values()];
  const matched = productEntries
    .filter((entry) => comparisonProductReferenceMatches(normalizedMessage, messageTokens, productName(entry)))
    .flatMap((entry) => {
      const preferred = preferredComparisonEntry(knowledge, entry.productSlug as string);
      return preferred ? [preferred] : [entry];
    })
    .sort((left, right) =>
      comparisonProductReferenceIndex(normalizedMessage, messageTokens, productName(left))
      - comparisonProductReferenceIndex(normalizedMessage, messageTokens, productName(right)));
  if (matched.length < 2) return null;
  const [first, second] = matched.slice(0, 2) as [KnowledgeEntry, KnowledgeEntry];
  const firstName = productName(first);
  const secondName = productName(second);
  const firstSummary = approvedProductSummary(first);
  const secondSummary = approvedProductSummary(second);
  const sameConcern = first.recommendationConcern && first.recommendationConcern === second.recommendationConcern;
  const concern = first.recommendationConcern === "blood_sugar"
    ? "blood-sugar support"
    : first.recommendationConcern?.replace(/_/gu, " ");
  const text = sameConcern && concern
    ? `${firstName} and ${secondName} both support ${concern}, but they are positioned differently. ${firstName}: ${firstSummary}. ${secondName}: ${secondSummary}.`
    : `${firstName}: ${firstSummary}. ${secondName}: ${secondSummary}.`;
  const references = [first, second].map((entry) => ({
    key: entry.key,
    title: entry.title,
    sourceName: entry.sourceName,
    sourceUrl: entry.sourceUrl,
  }));
  return {
    decision: "ALLOW",
    category: "PRODUCT_COMPARISON",
    messages: [{ type: "text", text: formatCommerceCopy(text, 55) }],
    recommendedProducts: [first, second].map((entry) => ({
      productSlug: entry.productSlug as string,
      name: productName(entry),
      productUrl: entry.sourceUrl,
      reason: `View ${productName(entry)}`,
    })),
    knowledgeReferences: references,
    handoff: null,
    model: null,
    promptVersion: COMMERCE_PROMPT_VERSION,
    guardrailStage: "INPUT",
    usage: noUsage,
  };
}

const generalProductInfoPattern = /\b(?:what is|what does|what's|tell me about|benefits? of|used for|use of)\b|\b(?:kya (?:hai|karta hai|karti hai)|kis kaam|kaise kaam)\b|(?:क्या है|क्या करता|फायदे)/iu;

function normalizedWords(value: string): string {
  return value.toLocaleLowerCase("en-IN").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function productReferenceMatches(normalizedMessage: string, name: string): boolean {
  const full = normalizedWords(name);
  const withoutMerchandisingSuffix = full.replace(/\b(?:pro|fizz)\b/gu, " ").replace(/\s+/gu, " ").trim();
  const knownAliases = full === "karela jamun fizz" ? ["karela jamun", "karela fizz"] : [];
  return [full, withoutMerchandisingSuffix, ...knownAliases]
    .filter((candidate) => candidate.split(" ").length >= 2)
    .some((candidate) => normalizedMessage.includes(` ${candidate} `));
}

function tokenApproximatelyMatches(token: string, target: string): boolean {
  if (token === target || token.includes(target) || (target.includes(token) && token.length >= 5)) return true;
  const tolerance = target.length >= 9 ? 2 : 1;
  return token.length >= 4
    && Math.abs(token.length - target.length) <= tolerance
    && editDistance(token, target) <= tolerance;
}

function comparisonProductReferenceMatches(normalizedMessage: string, messageTokens: readonly string[], name: string): boolean {
  if (productReferenceMatches(normalizedMessage, name)) return true;
  const full = normalizedWords(name);
  const withoutMerchandisingSuffix = full.replace(/\b(?:pro|fizz)\b/gu, " ").replace(/\s+/gu, " ").trim();
  const knownAliases = full === "karela jamun fizz" ? ["karela jamun", "karela fizz"] : [];
  return [withoutMerchandisingSuffix, ...knownAliases]
    .filter(Boolean)
    .some((candidate) => {
      const candidateTokens = candidate.split(/\s+/u).filter(Boolean);
      if (candidateTokens.length < 2 && (candidateTokens[0]?.length ?? 0) < 7) return false;
      return candidateTokens.every((target) => messageTokens.some((token) => tokenApproximatelyMatches(token, target)));
    });
}

function comparisonProductReferenceIndex(normalizedMessage: string, messageTokens: readonly string[], name: string): number {
  const full = normalizedWords(name);
  const withoutMerchandisingSuffix = full.replace(/\b(?:pro|fizz)\b/gu, " ").replace(/\s+/gu, " ").trim();
  const knownAliases = full === "karela jamun fizz" ? ["karela jamun", "karela fizz"] : [];
  void normalizedMessage;
  const tokenIndexes = [full, withoutMerchandisingSuffix, ...knownAliases]
    .filter(Boolean)
    .flatMap((candidate) => candidate.split(/\s+/u).filter(Boolean))
    .flatMap((target) => {
      const index = messageTokens.findIndex((token) => tokenApproximatelyMatches(token, target));
      return index >= 0 ? [index] : [];
    });
  return tokenIndexes.length ? Math.min(...tokenIndexes) : Number.MAX_SAFE_INTEGER;
}

const productDiseaseClaimPattern = /\b(?:cure|treat|reverse|heal|control|manage|disa+p+ear|go away|end|remove)\b.{0,45}\b(?:diabetes|diabetic|blood sugar|glucose|liver|fatty liver|heart|thyroid)\b|\b(?:diabetes|diabetic|blood sugar|glucose|liver|fatty liver|heart|thyroid)\b.{0,45}\b(?:cure|treat|reverse|heal|control|manage|disa+p+ear|go away|end|remove)\b|\b(?:ठीक|इलाज|कंट्रोल)\b/iu;
const diseaseOutcomeVerbPattern = /\b(?:cure|treat|reverse|heal|control|manage|disa+p+ear|go away|end|remove|permanent(?:ly)?)\b|\b(?:ठीक|इलाज|कंट्रोल)\b/iu;

/**
 * Keeps an outcome/condition question about one named product anchored to that
 * product. Without this route, the condition word (for example, "diabetes")
 * can incorrectly invoke broad category discovery and replace the product the
 * customer actually asked about.
 */
export function deterministicNamedProductClaim(
  input: CommerceChatRequest,
  knowledge: readonly KnowledgeEntry[],
): CommerceChatResponse | null {
  const normalizedMessage = ` ${normalizedWords(input.message)} `;
  const productEntries = knowledge.filter((entry) => entry.sourceType === "product"
    && entry.recommendationEligible === true
    && entry.productSlug);
  const matched = productEntries.find((entry) => productReferenceMatches(normalizedMessage, productName(entry)));
  if (!productDiseaseClaimPattern.test(input.message)
    && !(matched && diseaseOutcomeVerbPattern.test(input.message))) return null;
  const diabetes = /\b(?:diabetes|diabetic|blood sugar|glucose)\b|(?:डायबिटीज|मधुमेह|ब्लड शुगर)/iu.test(input.message);
  if (!matched) {
    if (!diabetes) return null;
    const text = input.language === "hi"
      ? "सप्लीमेंट डायबिटीज़ का इलाज नहीं करते और इसे खत्म नहीं कर सकते। Muditam सप्लीमेंट स्वस्थ ब्लड शुगर मैनेजमेंट को सपोर्ट करने के लिए बनाए गए हैं। अधिक जानकारी और व्यक्तिगत सलाह के लिए हमारे डाइटिशियन या सपोर्ट टीम से संपर्क करें।"
      : input.language === "hinglish" || /\b(?:kya|kab|kitni|jaldi|hoga|hogi|hai)\b/iu.test(input.message)
        ? "Supplements diabetes ko cure ya khatam nahi karte. Muditam supplements healthy blood-sugar management ko support karne ke liye formulated hain. Zyada jaankari aur personalized guidance ke liye hamare dietitian ya support team se connect karein."
        : "Supplements do not cure diabetes or make it disappear. Muditam supplements are formulated to support healthy blood-sugar management. For more information and personalized guidance, please connect with our dietitian or support team.";
    return {
      ...response(input, {
        decision: "HANDOFF",
        category: "EXPERT_HANDOFF",
        messages: [{ type: "text", text }],
        handoff: expertHandoff("dietitian", "Customer asked whether diabetes can be cured or made to disappear"),
        guardrailStage: "INPUT",
      }),
    };
  }
  const overview = productEntries.find((entry) => entry.productSlug === matched.productSlug && /:overview$/u.test(entry.key)) ?? matched;
  const name = productName(overview);
  const supportsBloodSugar = diabetes || overview.recommendationConcern === "blood_sugar";
  const concern = diabetes ? "diabetes" : "a health condition";
  const text = input.language === "hi"
    ? `${name} ${concern === "diabetes" ? "डायबिटीज़ का इलाज नहीं करता" : "किसी स्वास्थ्य स्थिति का इलाज नहीं करता"}। यह एक हेल्थ सप्लीमेंट है, जिसे स्वस्थ ${supportsBloodSugar ? "ब्लड शुगर मैनेजमेंट" : "वेलनेस मैनेजमेंट"} को सपोर्ट करने के लिए बनाया गया है। अधिक जानकारी और व्यक्तिगत सलाह के लिए हमारे डाइटिशियन या सपोर्ट टीम से संपर्क करें।`
    : input.language === "hinglish" || /\b(?:kya|karta|karti|hai|kar|sakta|saktha)\b/iu.test(input.message)
      ? `${name} ${concern} ko cure nahi karta. Yeh ek health supplement hai jo healthy ${supportsBloodSugar ? "blood-sugar management" : "wellness management"} ko support karne ke liye formulated hai. Zyada jaankari aur personalized guidance ke liye hamare dietitian ya support team se connect karein.`
      : `${name} does not cure ${concern}. It is a health supplement formulated to support healthy ${supportsBloodSugar ? "blood-sugar management" : "wellness management"}. For more information and personalized guidance, please connect with our dietitian or support team.`;
  return {
    decision: "HANDOFF",
    category: "PRODUCT_INFORMATION",
    messages: [{ type: "text", text }],
    recommendedProducts: [{
      productSlug: overview.productSlug as string,
      name,
      productUrl: overview.sourceUrl,
      reason: `View ${name}`,
    }],
    knowledgeReferences: [{ key: overview.key, title: overview.title, sourceName: overview.sourceName, sourceUrl: overview.sourceUrl }],
    handoff: expertHandoff("dietitian", `Customer asked whether ${name} cures or controls a health condition`),
    model: null,
    promptVersion: COMMERCE_PROMPT_VERSION,
    guardrailStage: "INPUT",
    usage: noUsage,
  };
}

export function deterministicProductCertification(
  input: CommerceChatRequest,
  knowledge: readonly KnowledgeEntry[],
): CommerceChatResponse | null {
  if (!certificationQuestionPattern.test(input.message)) return null;
  const normalizedMessage = ` ${normalizedWords(input.message)} `;
  const productEntries = knowledge.filter((entry) => entry.sourceType === "product"
    && entry.recommendationEligible === true
    && entry.productSlug);
  const matched = productEntries.find((entry) => productReferenceMatches(normalizedMessage, productName(entry)));
  if (!matched) {
    return response(input, {
      decision: "ALLOW",
      category: "PRODUCT_INFORMATION",
      messages: [{
        type: "text",
        text: "Muditam’s published About page states that every product is FSSAI and GMP certified. The Certificates page specifically lists USFDA documentation and WHO-GMP for Karela Jamun Fizz and Sugar Defend Pro. We should not describe every product as FDA approved or WHO-GMP certified.",
      }],
      handoff: null,
      guardrailStage: "INPUT",
    });
  }
  const overview = productEntries.find((entry) => entry.productSlug === matched.productSlug && /:overview$/u.test(entry.key)) ?? matched;
  const certificationEntry = productEntries.find((entry) => entry.productSlug === matched.productSlug
    && /^Published certifications:/imu.test(entry.content)) ?? overview;
  const certifications = certificationEntry.content.match(/^Published certifications:\s*(.+)$/imu)?.[1]?.trim();
  const name = productName(overview);
  const text = certifications
    ? `${name} has these certifications or published compliance documents listed by Muditam: ${certifications}. “USFDA documentation” should not be described as FDA approval.`
    : `${name} is covered by Muditam’s published FSSAI and GMP certification statement. No additional product-specific USFDA or WHO-GMP document is currently listed in the verified catalogue.`;
  return {
    decision: "ALLOW",
    category: "PRODUCT_INFORMATION",
    messages: [{ type: "text", text }],
    recommendedProducts: [{ productSlug: overview.productSlug as string, name, productUrl: overview.sourceUrl, reason: `View ${name}` }],
    knowledgeReferences: [{ key: certificationEntry.key, title: certificationEntry.title, sourceName: certificationEntry.sourceName, sourceUrl: certificationEntry.sourceUrl }],
    handoff: null,
    model: null,
    promptVersion: COMMERCE_PROMPT_VERSION,
    guardrailStage: "INPUT",
    usage: noUsage,
  };
}

export function deterministicProductInformation(
  input: CommerceChatRequest,
  knowledge: readonly KnowledgeEntry[],
): CommerceChatResponse | null {
  if (!generalProductInfoPattern.test(input.message)) return null;
  const normalizedMessage = ` ${normalizedWords(input.message)} `;
  const productEntries = knowledge.filter((entry) => entry.sourceType === "product"
    && entry.recommendationEligible === true
    && entry.productSlug);
  const matched = productEntries.find((entry) => {
    const name = normalizedWords(productName(entry));
    return name.length >= 4 && normalizedMessage.includes(` ${name} `);
  });
  if (!matched) return null;
  const overview = productEntries.find((entry) => entry.productSlug === matched.productSlug && /:overview$/u.test(entry.key)) ?? matched;
  const name = productName(overview);
  const description = overview.content.match(/^Published description:\s*(.+)$/imu)?.[1]?.trim();
  const ingredients = overview.content.match(/^Key ingredients:\s*(.+)$/imu)?.[1]?.trim();
  const category = overview.content.match(/^Category:\s*(.+)$/imu)?.[1]?.trim().replace(/_/gu, " ") ?? "daily";
  const hinglish = input.language === "hinglish" || /\b(?:kya|karta|karti|hai|kaise)\b/iu.test(input.message);
  const text = hinglish
    ? `${name} ${category} wellness ko support karne ke liye formulated hai.${ingredients ? ` Iske key ingredients ${ingredients} hain.` : ""}`
    : `${name} ${description ?? `is formulated for ${category} wellness support.`}${ingredients ? ` Key ingredients include ${ingredients}.` : ""}`;
  return {
    decision: "ALLOW",
    category: "PRODUCT_INFORMATION",
    messages: [{ type: "text", text }],
    recommendedProducts: [{
      productSlug: overview.productSlug as string,
      name,
      productUrl: overview.sourceUrl,
      reason: `Learn more about ${name}`,
    }],
    knowledgeReferences: [{ key: overview.key, title: overview.title, sourceName: overview.sourceName, sourceUrl: overview.sourceUrl }],
    handoff: null,
    model: null,
    promptVersion: COMMERCE_PROMPT_VERSION,
    guardrailStage: "INPUT",
    usage: noUsage,
  };
}

function publishedDosageFromEntry(entry: KnowledgeEntry): string | null {
  const clean = (value: string) => value.replace(/\.\s*Take with With\b/iu, ". How to take: With").trim();
  const explicit = entry.content.match(/^Published dosage:\s*(.+)$/imu)?.[1]?.trim();
  if (explicit) return clean(explicit);

  if (/\b(?:dose|dosage)\b/iu.test(entry.title)) {
    const answer = entry.content.match(/^Published answer:\s*(.+)$/imu)?.[1]?.trim();
    if (answer) {
      return clean(answer
        .replace(/\s*(?:For personalized advice|For additional guidance|If you need personalized advice)[\s\S]*$/iu, "")
        .trim());
    }
  }

  const recommended = entry.content.match(/Recommended Dose:\s*(.+?)(?=\s+Best Taken With:|\s+Course Duration:|\s+Cycle:|$)/iu)?.[1]?.trim();
  const takenWith = entry.content.match(/Best Taken With:\s*(.+?)(?=\s+Course Duration:|\s+Cycle:|$)/iu)?.[1]?.trim();
  if (recommended) return clean([recommended, takenWith && `Best taken with ${takenWith}`].filter(Boolean).join(". "));

  const dosage = entry.content.match(/\bDosage:\s*(.+?)(?=\s+How to Take:|\s+Duration:|$)/iu)?.[1]?.trim();
  const howToTake = entry.content.match(/How to Take:\s*(.+?)(?=\s+Duration:|$)/iu)?.[1]?.trim();
  return dosage ? clean([dosage, howToTake && `How to take: ${howToTake}`].filter(Boolean).join(". ")) : null;
}

export function deterministicProductDosage(
  input: CommerceChatRequest,
  knowledge: readonly KnowledgeEntry[],
): CommerceChatResponse | null {
  if (!dosageQuestionPattern.test(input.message)) return null;
  const productEntries = knowledge.filter((entry) => entry.sourceType === "product"
    && entry.recommendationEligible === true
    && entry.productSlug);
  const normalizedMessage = ` ${normalizedWords(input.message)} `;
  const explicitlyMatched = productEntries.find((entry) => {
    return productReferenceMatches(normalizedMessage, productName(entry));
  });
  const uniqueSlugs = [...new Set(productEntries.map((entry) => entry.productSlug as string))];
  const productSlug = explicitlyMatched?.productSlug ?? (uniqueSlugs.length === 1 ? uniqueSlugs[0] : null);
  const matchingEntries = productSlug ? productEntries.filter((entry) => entry.productSlug === productSlug) : [];
  const dosageEntry = matchingEntries.find((entry) => publishedDosageFromEntry(entry));
  const dosage = dosageEntry ? publishedDosageFromEntry(dosageEntry) : null;

  if (dosageEntry && dosage && productSlug) {
    const overview = matchingEntries.find((entry) => /:overview$/u.test(entry.key)) ?? dosageEntry;
    const name = productName(overview);
    const text = input.language === "hi"
      ? `${name} के प्रकाशित उपयोग निर्देश: ${dosage}`
      : input.language === "hinglish"
        ? `${name} ka published dosage: ${dosage}`
        : `The published dosage for ${name} is: ${dosage}`;
    const consultationLine = "Our doctor or dietitian can guide you through a FREE consultation.";
    return {
      decision: "ALLOW",
      category: "PRODUCT_INFORMATION",
      messages: [{ type: "text", text: `${text}\n\n${consultationLine}` }],
      recommendedProducts: [{ productSlug, name, productUrl: overview.sourceUrl, reason: `View ${name}` }],
      knowledgeReferences: [{ key: dosageEntry.key, title: dosageEntry.title, sourceName: dosageEntry.sourceName, sourceUrl: dosageEntry.sourceUrl }],
      handoff: expertHandoff("dietitian", "Customer requested published product dosage"),
      model: null,
      promptVersion: COMMERCE_PROMPT_VERSION,
      guardrailStage: "INPUT",
      usage: noUsage,
    };
  }

  return response(input, {
    decision: "HANDOFF",
    category: "EXPERT_HANDOFF",
    messages: [{
      type: "text",
      text: input.language === "hi"
        ? "इस प्रोडक्ट की सत्यापित खुराक अभी उपलब्ध नहीं है। हमारे डॉक्टर या डाइटिशियन मुफ़्त परामर्श में आपका मार्गदर्शन कर सकते हैं।"
        : input.language === "hinglish"
          ? "Is product ka verified dosage abhi available nahi hai. Hamare doctor ya dietitian FREE consultation mein aapko guide kar sakte hain."
          : "I don’t have a verified published dosage for this product yet. Our doctor or dietitian can guide you through a FREE consultation.",
    }],
    handoff: expertHandoff("dietitian", "Published product dosage was unavailable"),
    guardrailStage: "INPUT",
  });
}

interface ShopifyVariant {
  title: string;
  price: number;
  compareAtPrice: number | null;
  available: boolean;
}

function shopifyVariants(entry: KnowledgeEntry): ShopifyVariant[] {
  const line = entry.content.match(/^Shopify variants:\s*(.+)$/imu)?.[1];
  if (!line) return [];
  return line.split(/\s+\|\s+/u).flatMap((item) => {
    try {
      const parsed = JSON.parse(item) as Partial<ShopifyVariant>;
      const price = Number(parsed.price);
      if (!parsed.title || !Number.isFinite(price)) return [];
      return [{
        title: String(parsed.title),
        price,
        compareAtPrice: parsed.compareAtPrice == null || !Number.isFinite(Number(parsed.compareAtPrice)) ? null : Number(parsed.compareAtPrice),
        available: parsed.available === true,
      }];
    } catch {
      return [];
    }
  });
}

function formatRupees(value: number): string {
  return `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value)}`;
}

function publishedQuantity(entry: KnowledgeEntry): string | null {
  return entry.content.match(/^(?:Approved|Published) quantity:\s*(.+)$/imu)?.[1]?.trim() ?? null;
}

export function deterministicProductCommercialDetails(
  input: CommerceChatRequest,
  knowledge: readonly KnowledgeEntry[],
): CommerceChatResponse | null {
  const asksPrice = priceQuestionPattern.test(input.message);
  const asksCheapest = cheapestProductPattern.test(input.message);
  const asksVariants = variantQuestionPattern.test(input.message);
  const asksUnitQuantity = unitQuantityQuestionPattern.test(input.message);
  const asksShelfLife = shelfLifeQuestionPattern.test(input.message);
  const asksEverything = completeProductDetailsPattern.test(input.message);
  const repliesInHinglish = input.language === "hinglish"
    || /\b(?:kya|ka|ki|ke|kitna|kitni|hai|hain|batao|chahiye)\b/iu.test(input.message);
  if (!asksPrice && !asksCheapest && !asksVariants && !asksUnitQuantity && !asksShelfLife && !asksEverything) return null;

  if (asksShelfLife && !asksPrice && !asksVariants && !asksEverything) {
    const text = input.language === "hi"
      ? "मुदितम के सभी प्रोडक्ट की शेल्फ लाइफ 18 महीने है।"
      : repliesInHinglish
        ? "Muditam ke sabhi products ki shelf life 18 months hai."
        : "All Muditam products have a shelf life of 18 months.";
    return response(input, {
      decision: "ALLOW",
      category: "PRODUCT_INFORMATION",
      messages: [{ type: "text", text }],
      handoff: null,
      guardrailStage: "INPUT",
    });
  }

  const productEntries = knowledge.filter((entry) => entry.sourceType === "product"
    && entry.recommendationEligible === true
    && entry.productSlug);
  if (asksCheapest) {
    const candidates = [...new Map(productEntries.map((entry) => [entry.productSlug as string, entry])).values()]
      .flatMap((overview) => {
        const details = productEntries.find((entry) => entry.productSlug === overview.productSlug && shopifyVariants(entry).length > 0);
        const cheapestVariant = details && shopifyVariants(details)
          .filter((variant) => variant.available && variant.price > 0)
          .sort((left, right) => left.price - right.price)[0];
        return details && cheapestVariant ? [{ overview, details, variant: cheapestVariant }] : [];
      });
    const lowestPrice = Math.min(...candidates.map((candidate) => candidate.variant.price));
    const cheapest = candidates
      .filter((candidate) => candidate.variant.price === lowestPrice)
      .sort((left, right) => (left.overview.overallRank ?? Number.MAX_SAFE_INTEGER) - (right.overview.overallRank ?? Number.MAX_SAFE_INTEGER));
    if (!cheapest.length || !Number.isFinite(lowestPrice)) {
      return response(input, {
        decision: "HANDOFF",
        category: "ORDER_OR_SUPPORT",
        messages: [{ type: "text", text: "I couldn’t load the current Shopify prices. Muditam support can confirm the lowest-priced available product." }],
        handoff: expertHandoff("support", "Current Shopify catalogue prices were unavailable"),
        guardrailStage: "INPUT",
      });
    }
    const names = cheapest.map(({ overview }) => productName(overview));
    const option = cheapest[0]!.variant.title;
    const text = names.length === 1
      ? `Our lowest-priced available product is ${names[0]}, starting at ${formatRupees(lowestPrice)} for ${option}. Prices are taken from the current Shopify catalogue.`
      : `Our lowest current starting price is ${formatRupees(lowestPrice)}, available for ${names.join(" and ")}. Prices are taken from the current Shopify catalogue.`;
    return {
      decision: "ALLOW",
      category: "PRODUCT_DISCOVERY",
      messages: [{ type: "text", text }],
      recommendedProducts: cheapest.map(({ overview }) => ({
        productSlug: overview.productSlug as string,
        name: productName(overview),
        productUrl: overview.sourceUrl,
        reason: `Starts at ${formatRupees(lowestPrice)}`,
      })),
      knowledgeReferences: cheapest.map(({ details }) => ({ key: details.key, title: details.title, sourceName: details.sourceName, sourceUrl: details.sourceUrl })),
      handoff: null,
      model: null,
      promptVersion: COMMERCE_PROMPT_VERSION,
      guardrailStage: "INPUT",
      usage: noUsage,
    };
  }
  const normalizedMessage = ` ${normalizedWords(input.message)} `;
  const explicitlyMatched = productEntries.find((entry) => {
    return productReferenceMatches(normalizedMessage, productName(entry));
  });
  const uniqueSlugs = [...new Set(productEntries.map((entry) => entry.productSlug as string))];
  const productSlug = explicitlyMatched?.productSlug ?? (uniqueSlugs.length === 1 ? uniqueSlugs[0] : null);
  const matchingEntries = productSlug ? productEntries.filter((entry) => entry.productSlug === productSlug) : [];
  const detailsEntry = matchingEntries.find((entry) => shopifyVariants(entry).length > 0)
    ?? matchingEntries.find((entry) => publishedQuantity(entry))
    ?? matchingEntries.find((entry) => /Shelf life:\s*18 months/iu.test(entry.content));

  if (!productSlug || !detailsEntry) {
    return response(input, {
      decision: "HANDOFF",
      category: "ORDER_OR_SUPPORT",
      messages: [{
        type: "text",
        text: repliesInHinglish
          ? "Is product ki current Shopify details available nahi hain. Muditam support aapko price aur pack options confirm kar sakta hai."
          : "I couldn’t load the current Shopify details for this product. Muditam support can confirm its price and pack options.",
      }],
      handoff: expertHandoff("support", "Current Shopify product details were unavailable"),
      guardrailStage: "INPUT",
    });
  }

  const overview = matchingEntries.find((entry) => /:overview$/u.test(entry.key)) ?? detailsEntry;
  const name = productName(overview);
  const allVariants = shopifyVariants(detailsEntry);
  const unitQuantity = matchingEntries.map(publishedQuantity).find(Boolean) ?? null;
  if (asksUnitQuantity && !unitQuantity) {
    return response(input, {
      decision: "HANDOFF",
      category: "ORDER_OR_SUPPORT",
      messages: [{ type: "text", text: repliesInHinglish
        ? `${name} ki verified bottle ya box quantity available nahi hai. Muditam support ise confirm kar sakta hai.`
        : `I don't have a verified bottle or box quantity for ${name}. Muditam support can confirm it.` }],
      handoff: expertHandoff("support", `Published unit quantity unavailable for ${name}`),
      guardrailStage: "INPUT",
    });
  }
  const requestedVariant = allVariants.find((variant) => normalizedMessage.includes(` ${normalizedWords(variant.title)} `));
  const variants = (requestedVariant ? [requestedVariant] : allVariants).filter((variant) => variant.available);
  if ((asksPrice || (asksVariants && !asksUnitQuantity) || asksEverything) && !variants.length) {
    return response(input, {
      decision: "HANDOFF",
      category: "ORDER_OR_SUPPORT",
      messages: [{ type: "text", text: `${name} ke current price aur pack options Shopify se available nahi hain. Muditam support inhe confirm kar sakta hai.` }],
      handoff: expertHandoff("support", `Shopify variants unavailable for ${name}`),
      guardrailStage: "INPUT",
    });
  }

  const variantText = variants.map((variant) => {
    const mrp = variant.compareAtPrice && variant.compareAtPrice > variant.price
      ? `, MRP ${formatRupees(variant.compareAtPrice)}`
      : "";
    return `${variant.title}: ${formatRupees(variant.price)}${mrp}`;
  }).join("; ");
  const parts = [
    asksUnitQuantity && unitQuantity && `${name} ke har bottle ya box mein ${unitQuantity} hote hain.`,
    (asksPrice || (asksVariants && !asksUnitQuantity) || asksEverything) && `${name} ke available Shopify options hain: ${variantText}.`,
    (asksShelfLife || asksEverything) && "Shelf life 18 months hai.",
  ].filter(Boolean);
  const hinglishText = parts.join(" ");
  const englishText = hinglishText
    .replace(`${name} ke har bottle ya box mein ${unitQuantity ?? ""} hote hain.`, `Each bottle or box of ${name} contains ${unitQuantity ?? ""}.`)
    .replace("ke available Shopify options hain:", "has these available Shopify options:")
    .replace("Shelf life 18 months hai.", "The shelf life is 18 months.");
  return {
    decision: "ALLOW",
    category: "PRODUCT_INFORMATION",
    messages: [{ type: "text", text: repliesInHinglish ? hinglishText : englishText }],
    recommendedProducts: [{ productSlug, name, productUrl: overview.sourceUrl, reason: `View ${name}` }],
    knowledgeReferences: [{ key: detailsEntry.key, title: detailsEntry.title, sourceName: detailsEntry.sourceName, sourceUrl: detailsEntry.sourceUrl }],
    handoff: null,
    model: null,
    promptVersion: COMMERCE_PROMPT_VERSION,
    guardrailStage: "INPUT",
    usage: noUsage,
  };
}

export function deterministicProductFactVerification(
  input: CommerceChatRequest,
  knowledge: readonly KnowledgeEntry[],
): CommerceChatResponse | null {
  const claim = input.message.match(claimedIngredientCountPattern);
  if (!claim?.[1]) return null;
  const claimedCount = Number(claim[1]);
  const normalizedMessage = ` ${normalizedWords(input.message)} `;
  const entry = knowledge.find((item) => item.sourceType === "product"
    && item.recommendationEligible === true
    && item.productSlug
    && productReferenceMatches(normalizedMessage, productName(item)));
  if (!entry?.productSlug) return null;
  const name = productName(entry);
  const explicitlyPublished = new RegExp(`\\b(?:exactly\\s+)?${claimedCount}\\s+(?:total\\s+)?ingredients?\\b`, "iu").test(entry.content);
  const publishedHerbs = entry.content.match(/\bblend of\s+(\d{1,3})\s+(?:traditionally known\s+)?herbs?\b/iu)?.[1];
  const text = explicitlyPublished
    ? `The approved product information confirms that ${name} has ${claimedCount} ingredients.`
    : publishedHerbs
      ? `I wouldn’t confirm ${claimedCount} ingredients. The approved description states that ${name} has a blend of ${publishedHerbs} traditionally known herbs, while its full composition also lists formulation ingredients.`
      : `I can’t verify that ${name} has exactly ${claimedCount} ingredients from the approved product information.`;
  return {
    decision: "ALLOW",
    category: "PRODUCT_INFORMATION",
    messages: [{ type: "text", text }],
    recommendedProducts: [{ productSlug: entry.productSlug, name, productUrl: entry.sourceUrl, reason: `View ${name}` }],
    knowledgeReferences: [{ key: entry.key, title: entry.title, sourceName: entry.sourceName, sourceUrl: entry.sourceUrl }],
    handoff: null,
    model: null,
    promptVersion: COMMERCE_PROMPT_VERSION,
    guardrailStage: "INPUT",
    usage: noUsage,
  };
}

export function deterministicFounderInformation(
  input: CommerceChatRequest,
  knowledge: readonly KnowledgeEntry[],
): CommerceChatResponse | null {
  if (!founderQuestionPattern.test(input.message)) return null;
  const approved = knowledge.find((entry) => entry.sourceType === "platform"
    && entry.sourceName === "Muditam Bot Flow"
    && /\b(?:founder|co[ -]?founder|founded by)\b|(?:संस्थापक|फाउंडर)/iu.test(`${entry.title} ${entry.content}`));
  if (!approved) {
    return response(input, {
      decision: "HANDOFF",
      category: "ORDER_OR_SUPPORT",
      messages: [{ type: "text", text: "I don’t have verified information about Muditam’s founder yet. Please connect with our support team for confirmation." }],
      handoff: expertHandoff("support", "Admin-approved founder information is unavailable"),
      guardrailStage: "INPUT",
    });
  }
  return {
    decision: "ALLOW",
    category: "PRODUCT_INFORMATION",
    messages: [{ type: "text", text: formatCommerceCopy(approved.content, 55) }],
    recommendedProducts: [],
    knowledgeReferences: [{ key: approved.key, title: approved.title, sourceName: approved.sourceName, sourceUrl: approved.sourceUrl }],
    handoff: null,
    model: null,
    promptVersion: COMMERCE_PROMPT_VERSION,
    guardrailStage: "INPUT",
    usage: noUsage,
  };
}

export function deterministicBestSeller(
  input: CommerceChatRequest,
  knowledge: readonly KnowledgeEntry[],
): CommerceChatResponse | null {
  if (!bestSellerPattern.test(input.message)) return null;
  const entry = knowledge.find((item) => item.sourceType === "product"
    && item.recommendationEligible === true
    && item.productSlug === BEST_SELLER_SLUG);
  if (!entry) return null;
  const name = productName(entry);
  const text = input.language === "hinglish"
    ? `Hamara sabse best-selling product ${name} hai — blood sugar aur metabolic wellness ke liye ek convenient daily drink.`
    : `Our best-selling product overall is ${name}, a convenient daily drink for blood-sugar and metabolic wellness support.`;
  return {
    decision: "ALLOW",
    category: "PRODUCT_DISCOVERY",
    messages: [{ type: "text", text }],
    recommendedProducts: [{
      productSlug: BEST_SELLER_SLUG,
      name,
      productUrl: entry.sourceUrl,
      reason: "Muditam's best-selling product",
    }],
    knowledgeReferences: [{
      key: entry.key,
      title: entry.title,
      sourceName: entry.sourceName,
      sourceUrl: entry.sourceUrl,
    }],
    handoff: null,
    model: null,
    promptVersion: COMMERCE_PROMPT_VERSION,
    guardrailStage: "INPUT",
    usage: noUsage,
  };
}

export function deterministicCommerceGuardrail(input: CommerceChatRequest): CommerceChatResponse | null {
  if (clearlyOffTopicPattern.test(input.message) && !currentMessageScopeSignalPattern.test(input.message)) {
    return response(input, {
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
      handoff: null,
      guardrailStage: "INPUT",
    });
  }
  if (addToCartCapabilityPattern.test(input.message)) {
    return response(input, {
      decision: "ALLOW",
      category: "ORDER_OR_SUPPORT",
      messages: [{
        type: "text",
        text: input.language === "hinglish"
          ? "Main products recommend karke unke product cards dikha sakta hoon, lekin chat ke andar aapki taraf se cart mein item add nahi kar sakta. Product card par Add to Cart button tap karein."
          : "I can recommend products and show their product cards, but I can’t add an item to your cart on your behalf. Please use the Add to Cart button on the product card.",
      }],
      handoff: null,
      guardrailStage: "INPUT",
    });
  }
  if (refundRequestPattern.test(input.message)) {
    return response(input, {
      decision: "HANDOFF",
      category: "ORDER_OR_SUPPORT",
      messages: [{
        type: "text",
        text: input.language === "hi"
          ? "रिफंड अनुरोध हमारी सपोर्ट टीम संभालती है। कृपया उनसे कॉल या WhatsApp पर संपर्क करें।"
          : input.language === "hinglish"
            ? "Refund request hamari support team handle karti hai. Please unse call ya WhatsApp par connect karein."
            : "Refund requests are handled by our support team. Please connect with them by call or WhatsApp.",
      }],
      handoff: expertHandoff("support", "Customer requested a refund"),
      guardrailStage: "INPUT",
    });
  }
  if (pregnancyOrBreastfeedingPattern.test(input.message)) {
    const breastfeeding = /\b(?:breastfeed(?:ing)?|nursing mother)\b|(?:स्तनपान)/iu.test(input.message);
    const situation = breastfeeding ? "breastfeeding" : "pregnancy";
    const text = input.language === "hi"
      ? `${breastfeeding ? "स्तनपान" : "गर्भावस्था"} के दौरान कोई भी Muditam सप्लीमेंट लेने से पहले अपने स्वास्थ्य सेवा प्रदाता से सलाह लेना ज़रूरी है। व्यक्तिगत सप्लीमेंट मार्गदर्शन के लिए आप हमारे डाइटिशियन या सपोर्ट टीम से भी जुड़ सकते हैं।`
      : input.language === "hinglish" || /\b(?:kya|le|lena|sakti|sakta|pregnancy mein)\b/iu.test(input.message)
        ? `${situation} ke dauran koi bhi Muditam supplement lene se pehle apne healthcare provider se consult karna zaroori hai. Personalized supplement guidance ke liye aap hamare dietitian ya support team se bhi connect kar sakte hain.`
        : `Regarding taking Muditam supplements during ${situation}, it is essential to consult your healthcare provider first. You can also connect with our dietitian or support team for personalized supplement guidance.`;
    return response(input, {
      decision: "HANDOFF",
      category: "EXPERT_HANDOFF",
      messages: [{ type: "text", text }],
      handoff: expertHandoff("dietitian", `Customer asked about supplement use during ${situation}`),
      guardrailStage: "INPUT",
    });
  }
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
  if (genericSideEffectQuestionPattern.test(input.message)) {
    return response(input, {
      decision: "HANDOFF",
      category: "EXPERT_HANDOFF",
      messages: [{
        type: "text",
        text: "All our products are health supplements and can generally be taken without consulting a doctor. However, if you want to be extra sure, we offer FREE doctor consultations to provide personalized guidance.",
      }],
      handoff: expertHandoff("doctor", "Customer asked a general product side-effect question"),
      guardrailStage: "INPUT",
    });
  }
  if (vaguePersonalRecommendationPattern.test(input.message) && !explicitWellnessGoalPattern.test(input.message)) {
    const hinglish = input.language === "hinglish" || /\b(?:mere|mujhe|konsa|kaunsa|sahi|rahega)\b/iu.test(input.message);
    return response(input, {
      decision: "ALLOW",
      category: "PRODUCT_DISCOVERY",
      messages: [{
        type: "text",
        text: hinglish
          ? "Aap kis wellness goal ke liye product chahte hain, jaise blood sugar, liver, heart, thyroid, gut health, sleep, bones, ya daily wellness?"
          : "What wellness goal would you like support with, such as blood sugar, liver, heart, thyroid, gut health, sleep, bones, or daily wellness?",
      }],
      handoff: null,
      guardrailStage: "INPUT",
    });
  }
  if (genericAllopathicMedicationQuestionPattern.test(input.message) && !namedHighRiskMedicinePattern.test(input.message)) {
    return response(input, {
      decision: "HANDOFF",
      category: "EXPERT_HANDOFF",
      messages: [{
        type: "text",
        text: input.language === "hi"
          ? "हमारे सभी प्रोडक्ट हेल्थ सप्लीमेंट हैं और आमतौर पर डॉक्टर से पूछे बिना लिए जा सकते हैं। फिर भी, पूरी तरह आश्वस्त होने के लिए आप हमारा मुफ़्त डॉक्टर परामर्श ले सकते हैं।"
          : input.language === "hinglish"
            ? "Hamare sabhi products health supplements hain aur generally doctor se consult kiye bina liye ja sakte hain. Agar aap extra sure hona chahte hain, hum FREE doctor consultation bhi dete hain."
            : "All our products are health supplements and can generally be taken without consulting a doctor. However, if you want to be extra sure, we offer FREE doctor consultations to provide personalized guidance.",
      }],
      handoff: expertHandoff("doctor", "Customer asked about taking supplements with generic allopathic medication"),
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
          : input.language === "hinglish"
            ? "Aap insulin ya medication le rahe hain, isliye supplement start karne se pehle hamari doctor team se quick compatibility check karna best rahega. Aap chat prefer karenge ya callback?"
          : "Since medication is involved, a quick compatibility check with our doctor would be best. Would you prefer a chat or a callback?",
      }],
      handoff: expertHandoff("doctor", "Medication compatibility or treatment-change question"),
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
        text: input.language === "hi"
          ? "हाँ, यह परामर्श पूरी तरह मुफ़्त है। हमारे डॉक्टर या डाइटिशियन व्यक्तिगत सप्लीमेंट और डाइट मार्गदर्शन दे सकते हैं।"
          : input.language === "hinglish"
            ? "Haan, consultation bilkul FREE hai. Hamare doctor ya dietitian personalized supplement aur diet guidance de sakte hain."
            : "Yes, the consultation is completely FREE. Our doctor or dietitian can provide personalized supplement and diet guidance.",
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
        text: input.language === "hi"
          ? "हमारे सभी प्रोडक्ट हेल्थ सप्लीमेंट हैं और आमतौर पर डॉक्टर से पूछे बिना लिए जा सकते हैं। फिर भी, पूरी तरह आश्वस्त होने के लिए आप हमारा मुफ़्त डॉक्टर परामर्श ले सकते हैं।"
          : input.language === "hinglish"
            ? "Hamare sabhi products health supplements hain aur generally doctor se consult kiye bina liye ja sakte hain. Agar aap extra sure hona chahte hain, hum FREE doctor consultation bhi dete hain."
            : "All our products are health supplements and can generally be taken without consulting a doctor. However, if you want to be extra sure, we offer FREE doctor consultations to provide personalized guidance.",
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

const leadingFactQuestionPattern = /^\s*(?:is|are|was|were|does|do|did|has|have)\b|\b(?:right|correct|is that true)\s*\??\s*$/iu;
const leadingFactStopWords = new Set([
  "a", "an", "and", "are", "did", "do", "does", "has", "have", "is", "it", "muditam",
  "correct", "exactly", "of", "our", "right", "that", "the", "this", "true", "was", "were", "your",
]);

function materialClaimTokens(message: string): string[] {
  return [...new Set(message.toLocaleLowerCase("en-IN").match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter((token) => token.length > 1 && !leadingFactStopWords.has(token));
}

function approvedKnowledgeExplicitlySupportsClaim(
  input: CommerceChatRequest,
  citedEntries: readonly KnowledgeEntry[],
): boolean {
  if (!leadingFactQuestionPattern.test(input.message)) return true;
  const tokens = materialClaimTokens(input.message);
  if (!tokens.length || !citedEntries.length) return false;
  const approvedText = citedEntries
    .map((entry) => `${entry.title} ${entry.content} ${entry.contentHi}`.toLocaleLowerCase("en-IN"))
    .join("\n");
  return tokens.every((token) => approvedText.includes(token));
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
    if (likelyInScopeSupportRequest(input.message)) {
      return {
        decision: "HANDOFF",
        category: "ORDER_OR_SUPPORT",
        messages: [{
          type: "text",
          text: input.language === "hinglish"
            ? "Main is request ka verified answer nahi de pa raha hoon. Hamari support team aapki help kar sakti hai."
            : "I couldn’t provide a verified answer for that request. Our support team can help you.",
        }],
        recommendedProducts: [],
        knowledgeReferences: [],
        handoff: expertHandoff("support", "In-scope request could not be answered from verified information"),
        model,
        promptVersion: COMMERCE_PROMPT_VERSION,
        guardrailStage: "OUTPUT",
        usage,
      };
    }
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
  const citedEntries = [...new Set(result.citedKnowledgeKeys)].flatMap((key) => {
    const entry = knowledgeByKey.get(key);
    return entry ? [entry] : [];
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

  if (!approvedKnowledgeExplicitlySupportsClaim(input, citedEntries)) {
    return {
      decision: "HANDOFF",
      category: "ORDER_OR_SUPPORT",
      messages: [{
        type: "text",
        text: input.language === "hinglish"
          ? "Main is claim ko approved Muditam information se verify nahi kar pa raha hoon. Hamari support team ise confirm kar sakti hai."
          : "I can’t verify that claim from approved Muditam information. Our support team can confirm it for you.",
      }],
      recommendedProducts: [],
      knowledgeReferences: [],
      handoff: expertHandoff("support", "Customer claim was not explicitly supported by approved knowledge"),
      model,
      promptVersion: COMMERCE_PROMPT_VERSION,
      guardrailStage: "OUTPUT",
      usage,
    };
  }

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
