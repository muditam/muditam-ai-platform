import type { CommerceChatRequest } from "./contracts.js";

export type CommerceLanguage = CommerceChatRequest["language"];

const devanagariPattern = /\p{Script=Devanagari}/u;

const strongHinglishPattern = /\b(?:kya|kyu|kyun|kaise|kaisa|kaisi|kaunsa|kaunsi|konsa|konsi|haan|nahi|nahin|mujhe|mera|meri|mere|aap|ap|batao|bataiye|chahiye|karna|karu|karo|lena|lu|loon|sakta|sakti|kitna|kitni|kab|ka|ki|ke|mein|mai|hu|hoon|hun|raha|rahi|rahe|wala|wali|liye|aur|abhi|thoda|zyada|jaankari)\b/iu;
const phraseHinglishPattern = /\b(?:le raha|le rahi|le rahe|kha raha|kha rahi|kha rahe|use kar|start kar|order kar|cart mein|ke liye|isliye|iske liye|uske liye|kya karu|kya lena|kaise lena|kitni baar|safe hai|theek hai|sahi hai|diabetes hai|sugar hai|insulin le|medicine le|dawai le|dawa le)\b/iu;
const romanHindiPronounPattern = /\b(?:mai|mein|mujhe|mera|meri|mere|aap|ap|ham|hum)\b/iu;
const romanHindiVerbPattern = /\b(?:hu|hoon|hun|hai|hain|raha|rahi|rahe|karna|karu|karo|lena|leta|leti|chahiye|sakta|sakti|batao|bataiye)\b/iu;
const englishIntentPattern = /\b(?:what|which|how|can|could|would|please|tell|need|want|should|does|is|are|do|have|taking|product|order|price|support|doctor|dietitian)\b/iu;

export function detectCommerceLanguage(message: string, fallback: CommerceLanguage = "en"): CommerceLanguage {
  const normalized = message.trim();
  if (!normalized) return fallback;
  if (devanagariPattern.test(normalized)) return "hi";
  if (phraseHinglishPattern.test(normalized)) return "hinglish";

  const hasPronoun = romanHindiPronounPattern.test(normalized);
  const hasVerb = romanHindiVerbPattern.test(normalized);
  if (hasPronoun && hasVerb) return "hinglish";

  const strongMatches = normalized.match(new RegExp(strongHinglishPattern.source, "giu")) ?? [];
  const uniqueSignals = new Set(strongMatches.map((item) => item.toLocaleLowerCase("en-IN")));
  if (uniqueSignals.size >= 2) return "hinglish";
  if (uniqueSignals.size === 1 && englishIntentPattern.test(normalized)) return "hinglish";

  return fallback;
}

export function normalizeCommerceLanguage(input: CommerceChatRequest): CommerceChatRequest {
  const detected = detectCommerceLanguage(input.message, input.language);
  return detected === input.language ? input : { ...input, language: detected };
}
