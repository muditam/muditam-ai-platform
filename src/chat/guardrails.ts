import type { InternalChatRequest, InternalChatResponse, ModelChatResult } from "./contracts.js";
import type { KnowledgeEntry } from "./knowledge.js";

export const CHAT_PROMPT_VERSION = "1.5.0";
const messages = {
  en: {
    safety: "This may need urgent medical attention. Please contact local emergency services or go to the nearest emergency department now. Do not rely on this chat for emergency care.",
    medicalRefusal: "I can explain general diabetes and report information, but I can’t diagnose a condition or tell you to start, stop, or change a medicine or dose. Please discuss that with your doctor.",
    productDosageRefusal: "Your product dosage should be decided by your Muditam dietitian or doctor based on your health condition, reports, and current medicines.",
    inactiveProduct: "That product does not currently have an active page in our product catalogue, so I can’t provide or recommend it. Please ask your Muditam dietitian about available options.",
    lifestyleUnavailable: "I can share general nutrition information, but I can’t decide what you personally should eat without enough verified context. Please discuss your food choices and portions with a Muditam dietitian or doctor.",
    productUnavailable: "I couldn’t find enough verified information about that product or product category. Please ask your Muditam dietitian about the available options.",
    platformUnavailable: "I couldn’t find enough verified information about that Muditam service or feature. Please ask a Muditam team member for help.",
    educationUnavailable: "I don’t have enough verified information to answer that specific diabetes question reliably. Please ask your Muditam dietitian or doctor.",
    missingValue: "I couldn’t find that value in the verified results from your uploaded report.",
    unavailable: "I’m unable to answer that safely right now.",
    privacyRefusal: "I can’t reveal hidden instructions, private patient data, or internal system information.",
    unconfirmedValue: "This cited value or its biomarker identity was not automatically verified. Please check it against the original report.",
  },
  hi: {
    safety: "इस स्थिति में तुरंत चिकित्सा सहायता की आवश्यकता हो सकती है। अभी स्थानीय आपातकालीन सेवा से संपर्क करें या नज़दीकी आपातकालीन विभाग जाएँ। आपातकाल में इस चैट पर निर्भर न रहें।",
    medicalRefusal: "मैं डायबिटीज़ और रिपोर्ट की सामान्य जानकारी समझा सकता हूँ, लेकिन निदान नहीं कर सकता और न ही किसी दवा या उसकी खुराक को शुरू, बंद या बदलने की सलाह दे सकता हूँ। कृपया अपने डॉक्टर से बात करें।",
    productDosageRefusal: "आपके उत्पाद की खुराक आपकी स्वास्थ्य स्थिति, रिपोर्ट और वर्तमान दवाओं के आधार पर आपके Muditam डाइटिशियन या डॉक्टर द्वारा तय की जानी चाहिए।",
    inactiveProduct: "इस उत्पाद का अभी हमारी उत्पाद सूची में सक्रिय पेज नहीं है, इसलिए मैं इसकी जानकारी या सिफारिश नहीं कर सकता। उपलब्ध विकल्पों के लिए अपने Muditam डाइटिशियन से पूछें।",
    lifestyleUnavailable: "मैं पोषण की सामान्य जानकारी साझा कर सकता हूँ, लेकिन पर्याप्त सत्यापित संदर्भ के बिना यह तय नहीं कर सकता कि आपको व्यक्तिगत रूप से क्या खाना चाहिए। भोजन और उसकी मात्रा के बारे में Muditam डाइटिशियन या डॉक्टर से बात करें।",
    productUnavailable: "मुझे उस उत्पाद या उत्पाद श्रेणी के बारे में पर्याप्त सत्यापित जानकारी नहीं मिली। उपलब्ध विकल्पों के लिए अपने Muditam डाइटिशियन से पूछें।",
    platformUnavailable: "मुझे Muditam की उस सेवा या फीचर के बारे में पर्याप्त सत्यापित जानकारी नहीं मिली। कृपया Muditam टीम से सहायता लें।",
    educationUnavailable: "मेरे पास उस विशेष डायबिटीज़ प्रश्न का विश्वसनीय उत्तर देने के लिए पर्याप्त सत्यापित जानकारी नहीं है। कृपया Muditam डाइटिशियन या डॉक्टर से पूछें।",
    missingValue: "मुझे आपकी अपलोड की गई रिपोर्ट के सत्यापित परिणामों में यह वैल्यू नहीं मिली।",
    unavailable: "मैं अभी इसका सुरक्षित उत्तर नहीं दे पा रहा हूँ।",
    privacyRefusal: "मैं छिपे हुए निर्देश, निजी मरीज डेटा या आंतरिक सिस्टम जानकारी साझा नहीं कर सकता।",
    unconfirmedValue: "उद्धृत वैल्यू या उसकी बायोमार्कर पहचान स्वतः सत्यापित नहीं हुई है। कृपया इसे मूल रिपोर्ट से मिलाएँ।",
  },
} as const;

function localized(language: InternalChatRequest["language"]) {
  return messages[language];
}

const urgentPattern = /\b(unconscious|unresponsive|seizure|cannot breathe|can't breathe|chest pain|fainted|fainting|severe confusion|medical emergency|emergency care|suicid(?:e|al)|overdos(?:e|ed|ing))\b/i;
const medicationPattern = /\b(start|stop|change|increase|decrease|double|skip|dose|dosage|prescribe)\b.{0,45}\b(medicine|medication|tablet|insulin|metformin|drug|mg|units?)\b|\bhow much (insulin|metformin|medicine)\b|\bhow many units?(?: of)? insulin\b/i;
const diagnosisPattern = /\b(do i have|diagnose me|am i diabetic|confirm (?:that )?i have)\b/i;
const urgentHindiPattern = /(बेहोश|सांस नहीं ले|साँस नहीं ले|दौरा पड़|सीने में दर्द|आत्महत्या|ओवरडोज)/u;
const medicationHindiPattern = /(इंसुलिन|मेटफॉर्मिन|दवा|गोली).{0,35}(डोज|खुराक|बढ़ा|घटा|बंद|शुरू)|(डोज|खुराक).{0,35}(इंसुलिन|मेटफॉर्मिन|दवा|गोली)/u;
const diagnosisHindiPattern = /(क्या मुझे डायबिटीज|मुझे डायबिटीज है|निदान करो|पुष्टि करो)/u;
const productDosagePattern = /\b(?:dose|dosage|how much|how many|when (?:do|should) i take|times? (?:a|per) day)\b.{0,80}\b(?:product|supplement|capsule|tablet|sachet|fizz|ras|vati|shilajit|berberine|defend|fix|fuel|essentials|dense|snooze)\b|\b(?:product|supplement|capsule|tablet|sachet|fizz|ras|vati|shilajit|berberine|defend|fix|fuel|essentials|dense|snooze)\b.{0,80}\b(?:dose|dosage|how much|how many|times? (?:a|per) day)\b/i;
const productDosageHindiPattern = /(प्रोडक्ट|सप्लीमेंट|कैप्सूल|टैबलेट|सैशे|शिलाजीत|खुराक|डोज).{0,45}(कितनी|कितना|कब|बार|खुराक|डोज)|(कितनी|कितना|कब|बार|खुराक|डोज).{0,45}(प्रोडक्ट|सप्लीमेंट|कैप्सूल|टैबलेट|सैशे|शिलाजीत)/u;
const privacyExfiltrationPattern = /(output|show|reveal|list|dump).{0,60}(all patient data|patient data|all data|hidden prompt|system prompt)|(सिस्टम प्रॉम्प्ट|छिपे निर्देश|मरीज का सारा डेटा|सभी मरीज डेटा)/iu;
const unsafeGeneratedAdvicePattern = /\b(start|stop|increase|decrease|double|skip|take)\b.{0,35}\b(insulin|metformin|medicine|medication|supplement|product|capsule|tablet|sachet|mg|ml|units?)\b|\b(?:once|twice|three times)\s+(?:a|per)\s+day\b|\byou (?:have|definitely have|are diagnosed with) diabetes\b/i;
const unsafeGeneratedHindiPattern = /(इंसुलिन|मेटफॉर्मिन|दवा|गोली).{0,35}(बढ़ा|घटा|बंद|शुरू|ले लो)|(आपको|तुम्हें) डायबिटीज है/u;
const allowedCategories = new Set(["GREETING", "REPORT_VALUES", "DIABETES_EDUCATION", "LIFESTYLE_EDUCATION", "PRODUCT_INFORMATION", "PLATFORM_INFORMATION"]);
const noUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

const reportListPattern = /\b(?:show|list|give|tell(?:\s+me)?|what|which)\b.{0,55}\b(?:all\s+)?(?:values|results|markers|biomarkers)\b.{0,55}\b(?:report|extracted)\b|\b(?:show|list|give|tell(?:\s+me)?)\b.{0,55}\b(?:report|extracted)\b.{0,55}\b(?:all\s+)?(?:values|results|markers|biomarkers)\b/i;
const reportListHindiPattern = /(दिखाओ|बताओ|लिस्ट|सभी|सारी).{0,55}(रिपोर्ट).{0,55}(वैल्यू|वैल्यूज़|मान|रिजल्ट|नतीजे)|(रिपोर्ट).{0,55}(सभी|सारी|दिखाओ|बताओ|लिस्ट).{0,55}(वैल्यू|वैल्यूज़|मान|रिजल्ट|नतीजे)|(रिपोर्ट).{0,55}(वैल्यू|वैल्यूज़|मान|रिजल्ट|नतीजे).{0,30}(दिखाओ|बताओ|लिस्ट)/u;
const reportProductDiscoveryPattern = /\b(?:recommend|suggest|which|what)\b.{0,100}\b(?:product|products|supplement|supplements)\b|\b(?:product|products|supplement|supplements)\b.{0,100}\b(?:recommend|suggest|right for|relevant|based on)\b|(?:रिपोर्ट).{0,80}(?:प्रोडक्ट|उत्पाद|सप्लीमेंट).{0,50}(?:बताओ|सुझाओ|सही|लें)|(?:प्रोडक्ट|उत्पाद|सप्लीमेंट).{0,80}(?:रिपोर्ट).{0,50}(?:बताओ|सुझाओ|सही|लें)/iu;

export function isReportAwareProductDiscovery(message: string): boolean {
  return /\b(?:report|results?|values?|hba1c|glucose|cholesterol|liver|heart)\b|(?:रिपोर्ट|रिजल्ट|वैल्यू|शुगर)/iu.test(message)
    && reportProductDiscoveryPattern.test(message);
}

function observationValueText(value: InternalChatRequest["observations"][number]["value"]): string {
  if (typeof value === "number" || typeof value === "string") return String(value);
  if (value.type === "NUMERIC" && value.numeric !== undefined) return String(value.numeric);
  if (value.type === "INEQUALITY" && value.numeric !== undefined) return `${value.comparator ?? ""} ${value.numeric}`.trim();
  if (value.type === "RANGE" && value.lower !== undefined && value.upper !== undefined) return `${value.lower}–${value.upper}`;
  return value.text ?? "—";
}

function observationCitation(item: InternalChatRequest["observations"][number]) {
  return {
    observationId: item.observationId,
    reportId: item.reportId,
    displayName: item.displayName,
    value: item.value,
    ...(item.unit === undefined ? {} : { unit: item.unit }),
    mappingStatus: item.mappingStatus,
    validationStatus: item.validationStatus,
    decision: item.decision,
    confidence: item.confidence,
  };
}

export function extractedValuesResponse(input: InternalChatRequest): InternalChatResponse | null {
  if (isReportAwareProductDiscovery(input.message)) return null;
  if (!reportListPattern.test(input.message) && !reportListHindiPattern.test(input.message)) return null;
  const copy = localized(input.language);
  if (!input.observations.length) {
    return { decision: "REFUSE", category: "REPORT_VALUES", answer: copy.missingValue, citations: [], knowledgeReferences: [], model: null, promptVersion: CHAT_PROMPT_VERSION, guardrailStage: "OUTPUT", usage: noUsage };
  }
  const heading = input.language === "hi" ? "आपकी रिपोर्ट से निकाली गई वैल्यूज़:" : "Values extracted from your report:";
  const verifiedLabel = input.language === "hi" ? "सत्यापित" : "verified";
  const reviewLabel = input.language === "hi" ? "जाँच आवश्यक" : "needs review";
  const lines = [heading];
  const cited = [];
  for (const item of input.observations) {
    const verified = item.decision === "AUTO_ACCEPT" && item.mappingStatus === "MAPPED" && item.validationStatus === "VALID";
    const unit = item.unit ? ` ${item.unit}` : "";
    const line = `• ${item.displayName}: ${observationValueText(item.value)}${unit} (${verified ? verifiedLabel : reviewLabel})`;
    if ([...lines, line].join("\n").length > 7600) break;
    lines.push(line);
    cited.push(observationCitation(item));
  }
  if (cited.length < input.observations.length) {
    lines.push(input.language === "hi"
      ? `• ${input.observations.length - cited.length} अतिरिक्त वैल्यूज़ इस संदेश की सीमा के कारण नहीं दिखाई गईं।`
      : `• ${input.observations.length - cited.length} additional values were omitted because of the message-size limit.`);
  }
  if (cited.some((item) => item.decision !== "AUTO_ACCEPT" || item.mappingStatus !== "MAPPED" || item.validationStatus !== "VALID")) {
    lines.push(copy.unconfirmedValue);
  }
  return { decision: "ALLOW", category: "REPORT_VALUES", answer: lines.join("\n"), citations: cited, knowledgeReferences: [], model: null, promptVersion: CHAT_PROMPT_VERSION, guardrailStage: "INPUT", usage: noUsage };
}

export function deterministicGuardrail(message: string, language: InternalChatRequest["language"]): InternalChatResponse | null {
  const copy = localized(language);
  if (urgentPattern.test(message) || urgentHindiPattern.test(message)) {
    return { decision: "SAFETY", category: "URGENT_SAFETY", answer: copy.safety, citations: [], knowledgeReferences: [], model: null, promptVersion: CHAT_PROMPT_VERSION, guardrailStage: "INPUT", usage: noUsage };
  }
  if (privacyExfiltrationPattern.test(message)) {
    return { decision: "REFUSE", category: "OFF_TOPIC", answer: copy.privacyRefusal, citations: [], knowledgeReferences: [], model: null, promptVersion: CHAT_PROMPT_VERSION, guardrailStage: "INPUT", usage: noUsage };
  }
  if (productDosagePattern.test(message) || productDosageHindiPattern.test(message)) {
    return { decision: "REFUSE", category: "PRODUCT_INFORMATION", answer: copy.productDosageRefusal, citations: [], knowledgeReferences: [], model: null, promptVersion: CHAT_PROMPT_VERSION, guardrailStage: "INPUT", usage: noUsage };
  }
  if (medicationPattern.test(message) || diagnosisPattern.test(message) || medicationHindiPattern.test(message) || diagnosisHindiPattern.test(message)) {
    return { decision: "REFUSE", category: "MEDICATION_OR_DIAGNOSIS", answer: copy.medicalRefusal, citations: [], knowledgeReferences: [], model: null, promptVersion: CHAT_PROMPT_VERSION, guardrailStage: "INPUT", usage: noUsage };
  }
  return null;
}

export function inactiveProductResponse(language: InternalChatRequest["language"]): InternalChatResponse {
  return { decision: "REFUSE", category: "PRODUCT_INFORMATION", answer: localized(language).inactiveProduct, citations: [], knowledgeReferences: [], model: null, promptVersion: CHAT_PROMPT_VERSION, guardrailStage: "INPUT", usage: noUsage };
}

const productDiscoveryConcerns = [
  {
    pattern: /\b(?:diabetes|diabetic|blood sugar|glucose|sugar patient)\b|(?:डायबिटीज|मधुमेह|ब्लड शुगर)/iu,
    slugs: ["sugar-defend-pro", "karela-jamun-fizz"],
    en: (names: string[]) => `For blood-sugar wellness support, you can consider ${names.join(" and ")}. They offer different formats for convenient daily support.`,
    hi: (names: string[]) => `ब्लड शुगर वेलनेस सपोर्ट के लिए आप ${names.join(" और ")} के बारे में जान सकते हैं। ये रोज़मर्रा के सपोर्ट के लिए अलग-अलग विकल्प हैं।`,
  },
  {
    pattern: /\b(?:heart|cardiac|cardiovascular)\b|(?:हार्ट|दिल)/iu,
    slugs: ["heart-defend-pro"],
    en: (names: string[]) => `For heart wellness support, you can consider ${names[0]}.`,
    hi: (names: string[]) => `हार्ट वेलनेस सपोर्ट के लिए आप ${names[0]} के बारे में जान सकते हैं।`,
  },
  {
    pattern: /\b(?:fatty liver|liver|lever)\b|(?:लिवर|जिगर)/iu,
    slugs: ["liver-defend-pro"],
    en: (names: string[]) => `For liver wellness support, you can consider ${names[0]}.`,
    hi: (names: string[]) => `लिवर वेलनेस सपोर्ट के लिए आप ${names[0]} के बारे में जान सकते हैं।`,
  },
] as const;

export function deterministicProductDiscoveryResponse(
  input: InternalChatRequest,
  knowledge: readonly KnowledgeEntry[],
): InternalChatResponse | null {
  if (isReportAwareProductDiscovery(input.message)) return null;
  const asksForProduct = /\b(?:product|products|supplement|supplements|recommend|suggest|something|anything)\b|(?:प्रोडक्ट|उत्पाद|सप्लीमेंट|सुझाओ|बताओ|कुछ)/iu.test(input.message);
  if (!asksForProduct) return null;
  const concern = productDiscoveryConcerns.find((item) => item.pattern.test(input.message));
  if (!concern) return null;
  const entries = concern.slugs.flatMap((slug) => {
    const entry = knowledge.find((item) => item.sourceType === "product"
      && item.recommendationEligible === true
      && item.productSlug === slug);
    return entry ? [entry] : [];
  });
  if (!entries.length) return null;
  const names = entries.map((entry) => entry.title.split(" — ")[0]?.trim() || entry.productSlug as string);
  return {
    decision: "ALLOW",
    category: "PRODUCT_INFORMATION",
    answer: input.language === "hi" ? concern.hi(names) : concern.en(names),
    citations: [],
    knowledgeReferences: entries.map((entry) => ({
      key: entry.key,
      title: entry.title,
      sourceName: entry.sourceName,
      sourceUrl: entry.sourceUrl,
    })),
    recommendedProducts: entries.map((entry, index) => ({
      productSlug: entry.productSlug as string,
      name: names[index] as string,
      productUrl: entry.sourceUrl,
      reason: input.language === "hi" ? "Muditam का सत्यापित वेलनेस उत्पाद" : "Verified Muditam wellness product",
    })),
    model: null,
    promptVersion: CHAT_PROMPT_VERSION,
    guardrailStage: "INPUT",
    usage: noUsage,
  };
}

export function formatChatAnswer(value: string, maxWords = 220): string {
  let answer = value
    .replace(/\r\n?/g, "\n")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/\*\*/g, "")
    .replace(/`{1,3}/g, "")
    .replace(/^[ \t]*[-*][ \t]+/gm, "• ")
    .replace(/[ \t]+-[ \t]+(?=[\p{L}\p{N}])/gu, "\n• ")
    .replace(/[ \t]+$/gm, "")
    .replace(/^[ \t]+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const words = [...answer.matchAll(/[\p{L}\p{N}][^\s]*/gu)];
  if (words.length > maxWords) {
    const last = words[maxWords - 1];
    if (last?.index !== undefined) answer = `${answer.slice(0, last.index + last[0].length).trimEnd()}…`;
  }
  return answer;
}

function unavailableForCategory(category: ModelChatResult["category"], language: InternalChatRequest["language"]): string {
  const copy = localized(language);
  if (category === "LIFESTYLE_EDUCATION") return copy.lifestyleUnavailable;
  if (category === "PRODUCT_INFORMATION") return copy.productUnavailable;
  if (category === "PLATFORM_INFORMATION") return copy.platformUnavailable;
  if (category === "DIABETES_EDUCATION") return copy.educationUnavailable;
  if (category === "REPORT_VALUES") return copy.missingValue;
  return copy.unavailable;
}

export function enforceModelResult(
  result: ModelChatResult,
  input: InternalChatRequest,
  knowledge: readonly KnowledgeEntry[],
  model: string,
  usage: InternalChatResponse["usage"],
): InternalChatResponse {
  const copy = localized(input.language);
  if (result.decision === "SAFETY" || result.category === "URGENT_SAFETY") {
    return { decision: "SAFETY", category: "URGENT_SAFETY", answer: copy.safety, citations: [], knowledgeReferences: [], model, promptVersion: CHAT_PROMPT_VERSION, guardrailStage: "MODEL", usage };
  }
  if (result.category === "MEDICATION_OR_DIAGNOSIS") {
    return { decision: "REFUSE", category: result.category, answer: copy.medicalRefusal, citations: [], knowledgeReferences: [], model, promptVersion: CHAT_PROMPT_VERSION, guardrailStage: "MODEL", usage };
  }
  if (result.decision === "REFUSE") {
    return { decision: "REFUSE", category: result.category, answer: unavailableForCategory(result.category, input.language), citations: [], knowledgeReferences: [], model, promptVersion: CHAT_PROMPT_VERSION, guardrailStage: "MODEL", usage };
  }
  if (!allowedCategories.has(result.category) || unsafeGeneratedAdvicePattern.test(result.answer) || unsafeGeneratedHindiPattern.test(result.answer)) {
    return { decision: "REFUSE", category: result.category, answer: copy.medicalRefusal, citations: [], knowledgeReferences: [], model, promptVersion: CHAT_PROMPT_VERSION, guardrailStage: "OUTPUT", usage };
  }
  const observationById = new Map(input.observations.map((item) => [item.observationId, item]));
  const citations = [...new Set(result.citedObservationIds)].flatMap((id) => {
    const item = observationById.get(id);
    return item ? [observationCitation(item)] : [];
  });
  if (result.category === "REPORT_VALUES" && citations.length === 0) {
    return { decision: "REFUSE", category: "REPORT_VALUES", answer: copy.missingValue, citations: [], knowledgeReferences: [], model, promptVersion: CHAT_PROMPT_VERSION, guardrailStage: "OUTPUT", usage };
  }
  if (result.category === "PRODUCT_INFORMATION" && isReportAwareProductDiscovery(input.message) && citations.length === 0) {
    return { decision: "REFUSE", category: "PRODUCT_INFORMATION", answer: copy.productUnavailable, citations: [], knowledgeReferences: [], recommendedProducts: [], model, promptVersion: CHAT_PROMPT_VERSION, guardrailStage: "OUTPUT", usage };
  }
  const knowledgeByKey = new Map(knowledge.map((item) => [item.key, item]));
  const knowledgeReferences = [...new Set(result.citedKnowledgeKeys)].flatMap((key) => {
    const item = knowledgeByKey.get(key);
    return item ? [{ key: item.key, title: item.title, sourceName: item.sourceName, sourceUrl: item.sourceUrl }] : [];
  });
  const eligibleProducts = new Map(knowledge
    .filter((item) => item.sourceType === "product" && item.recommendationEligible === true && item.productSlug)
    .map((item) => [item.productSlug as string, item]));
  const requestedRecommendations = result.recommendations ?? [];
  const explicitRecommendations = requestedRecommendations.flatMap((recommendation) => {
    const item = eligibleProducts.get(recommendation.productSlug);
    if (!item) return [];
    const formattedReason = formatChatAnswer(recommendation.reason, 24);
    const safeReason = unsafeGeneratedAdvicePattern.test(formattedReason) || unsafeGeneratedHindiPattern.test(formattedReason)
      ? `Learn more about ${item.title.split(" — ")[0]?.trim() || recommendation.productSlug}`
      : formattedReason;
    return [{
      productSlug: recommendation.productSlug,
      name: item.title.split(" — ")[0]?.trim() || recommendation.productSlug,
      productUrl: item.sourceUrl,
      reason: safeReason,
    }];
  });
  const citedRecommendations = result.citedKnowledgeKeys.flatMap((key) => {
    const item = knowledgeByKey.get(key);
    if (!item?.productSlug || !eligibleProducts.has(item.productSlug)) return [];
    const name = item.title.split(" — ")[0]?.trim() || item.productSlug;
    if (!result.answer.toLocaleLowerCase("en-IN").includes(name.toLocaleLowerCase("en-IN"))) return [];
    return [{
      productSlug: item.productSlug,
      name,
      productUrl: item.sourceUrl,
      reason: `Learn more about ${name}`,
    }];
  });
  const recommendedProducts = [...new Map(
    [...explicitRecommendations, ...citedRecommendations].map((item) => [item.productSlug, item]),
  ).values()].slice(0, 2);
  if (
    ["DIABETES_EDUCATION", "LIFESTYLE_EDUCATION", "PRODUCT_INFORMATION", "PLATFORM_INFORMATION"].includes(result.category) &&
    knowledgeReferences.length === 0
  ) {
    return { decision: "REFUSE", category: result.category, answer: unavailableForCategory(result.category, input.language), citations: [], knowledgeReferences: [], model, promptVersion: CHAT_PROMPT_VERSION, guardrailStage: "OUTPUT", usage };
  }
  let answer = result.answer.trim();
  if (!answer) {
    return { decision: "REFUSE", category: result.category, answer: copy.unavailable, citations: [], knowledgeReferences: [], model, promptVersion: CHAT_PROMPT_VERSION, guardrailStage: "OUTPUT", usage };
  }
  const citesUnconfirmedValue = citations.some((item) => (
    item.decision !== "AUTO_ACCEPT" ||
    item.mappingStatus !== "MAPPED" ||
    item.validationStatus !== "VALID"
  ));
  if (citesUnconfirmedValue && !answer.includes(copy.unconfirmedValue)) {
    answer = `${answer} ${copy.unconfirmedValue}`;
  }
  const maxWords = result.category === "PRODUCT_INFORMATION" && isReportAwareProductDiscovery(input.message) ? 80 : 220;
  return { decision: "ALLOW", category: result.category, answer: formatChatAnswer(answer, maxWords), citations, knowledgeReferences, recommendedProducts, model, promptVersion: CHAT_PROMPT_VERSION, guardrailStage: null, usage };
}
