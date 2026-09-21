export interface KnowledgeEntry {
  key: string;
  title: string;
  content: string;
  contentHi: string;
  keywords: string[];
  sourceName: string;
  sourceUrl: string;
  version: string;
  sourceType?: "curated" | "product" | "platform";
  productSlug?: string;
  recommendationEligible?: boolean;
  recommendationPriority?: "hidden" | "normal" | "boosted";
  overallRank?: number | null;
  tagRank?: number | null;
  recommendationConcern?: "blood_sugar" | "liver" | "heart" | "gut" | "bone";
  channels?: Array<"mobile_app" | "shopify_web">;
  audiences?: Array<"anonymous_visitor" | "verified_customer">;
}

export const KNOWLEDGE_VERSION = "2026-08-04.1";

export const diabetesKnowledge: readonly KnowledgeEntry[] = [
  {
    key: "diabetes-basics",
    title: "What diabetes means",
    content: "Diabetes is a long-term condition involving high blood glucose. Diagnosis requires clinical assessment and appropriate testing; the assistant must not diagnose from one result.",
    contentHi: "डायबिटीज़ एक दीर्घकालिक स्थिति है जिसमें रक्त ग्लूकोज़ अधिक रहता है। निदान के लिए चिकित्सकीय मूल्यांकन और उचित जाँच आवश्यक है; केवल एक परिणाम से निदान नहीं किया जाना चाहिए।",
    keywords: ["diabetes", "insulin", "blood sugar"],
    sourceName: "CDC Diabetes Basics",
    sourceUrl: "https://www.cdc.gov/diabetes/about/index.html",
    version: KNOWLEDGE_VERSION,
    channels: ["mobile_app"],
    audiences: ["verified_customer"],
  },
  {
    key: "hba1c-basics",
    title: "HbA1c meaning",
    content: "HbA1c reflects average glucose over roughly the previous two to three months. A clinician interprets it with symptoms, history, and other tests.",
    contentHi: "HbA1c लगभग पिछले दो से तीन महीनों के औसत ग्लूकोज़ को दर्शाता है। डॉक्टर इसे लक्षणों, स्वास्थ्य इतिहास और दूसरी जाँचों के साथ समझते हैं।",
    keywords: ["hba1c", "a1c", "glycated", "average glucose"],
    sourceName: "CDC A1C Test",
    sourceUrl: "https://www.cdc.gov/diabetes/diabetes-testing/prediabetes-a1c-test.html",
    version: KNOWLEDGE_VERSION,
    channels: ["mobile_app"],
    audiences: ["verified_customer"],
  },
  {
    key: "hypoglycemia-safety",
    title: "Low blood glucose safety",
    content: "Severe confusion, seizure, loss of consciousness, or inability to swallow with suspected low glucose requires immediate local emergency help.",
    contentHi: "कम ग्लूकोज़ की आशंका के साथ गंभीर भ्रम, दौरा, बेहोशी या निगल न पाना तत्काल स्थानीय आपातकालीन सहायता की आवश्यकता दर्शाता है।",
    keywords: ["low", "hypoglycemia", "unconscious", "seizure", "confusion"],
    sourceName: "CDC Low Blood Sugar",
    sourceUrl: "https://www.cdc.gov/diabetes/about/low-blood-sugar-hypoglycemia.html",
    version: KNOWLEDGE_VERSION,
    channels: ["mobile_app"],
    audiences: ["verified_customer"],
  },
  {
    key: "diabetes-testing-ranges",
    title: "General A1C and fasting glucose screening ranges",
    content: "General screening ranges are: A1C below 5.7% normal, 5.7–6.4% prediabetes range, and 6.5% or above diabetes range; fasting glucose 99 mg/dL or below normal, 100–125 mg/dL prediabetes range, and 126 mg/dL or above diabetes range. A clinician determines diagnosis and whether confirmation is needed.",
    contentHi: "सामान्य स्क्रीनिंग सीमाएँ: A1C 5.7% से कम सामान्य, 5.7–6.4% प्रीडायबिटीज़ सीमा और 6.5% या अधिक डायबिटीज़ सीमा; फास्टिंग ग्लूकोज़ 99 mg/dL या कम सामान्य, 100–125 mg/dL प्रीडायबिटीज़ सीमा और 126 mg/dL या अधिक डायबिटीज़ सीमा। निदान और पुष्टि की आवश्यकता डॉक्टर तय करते हैं।",
    keywords: ["range", "normal", "prediabetes", "fasting", "glucose", "hba1c", "a1c"],
    sourceName: "CDC Diabetes Testing",
    sourceUrl: "https://www.cdc.gov/diabetes/diabetes-testing/index.html",
    version: KNOWLEDGE_VERSION,
    channels: ["mobile_app"],
    audiences: ["verified_customer"],
  },
  {
    key: "healthy-eating",
    title: "General healthy eating with diabetes",
    content: "General healthy-eating patterns emphasize non-starchy vegetables, lean or plant proteins, quality carbohydrate sources, healthy fats, less added sugar, and fewer highly processed foods. Individual plans should reflect culture, preferences, access, and clinical needs.",
    contentHi: "सामान्य स्वस्थ भोजन में बिना स्टार्च वाली सब्ज़ियाँ, कम वसा या पौधों से मिलने वाला प्रोटीन, बेहतर कार्बोहाइड्रेट स्रोत, स्वस्थ वसा, कम अतिरिक्त चीनी और कम अत्यधिक प्रोसेस्ड भोजन शामिल होते हैं। व्यक्तिगत योजना संस्कृति, पसंद, उपलब्धता और चिकित्सकीय ज़रूरतों के अनुसार होनी चाहिए।",
    keywords: ["food", "eat", "eating", "diet", "meal", "vegetables", "carbs", "nutrition", "खाना", "खाऊं", "भोजन", "डाइट", "पोषण"],
    sourceName: "American Diabetes Association — Eating Well",
    sourceUrl: "https://diabetes.org/food-nutrition/eating-healthy",
    version: KNOWLEDGE_VERSION,
    channels: ["mobile_app"],
    audiences: ["verified_customer"],
  },
  {
    key: "whole-fruit-and-diabetes",
    title: "Whole fruit in a diabetes eating plan",
    content: "Whole fruit, including mango, can be included in a diabetes eating plan. Fruit contains carbohydrate, so portion size and the rest of the meal matter. Fresh, frozen, or canned fruit without added sugar is generally preferred over juice, and an individual's carbohydrate target should be agreed with their dietitian or health care team.",
    contentHi: "आम सहित साबुत फल डायबिटीज़ की भोजन योजना में शामिल किए जा सकते हैं। फल में कार्बोहाइड्रेट होता है, इसलिए मात्रा और साथ में खाया गया भोजन महत्वपूर्ण है। बिना अतिरिक्त चीनी वाले ताज़े, जमे हुए या डिब्बाबंद फल को आमतौर पर जूस से बेहतर माना जाता है। व्यक्तिगत कार्बोहाइड्रेट लक्ष्य डाइटिशियन या स्वास्थ्य देखभाल टीम के साथ तय किया जाना चाहिए।",
    keywords: ["fruit", "mango", "juice", "portion", "carbohydrate", "eat mango", "फल", "आम", "जूस", "मात्रा"],
    sourceName: "American Diabetes Association — Fruit",
    sourceUrl: "https://diabetes.org/food-nutrition/reading-food-labels/fruit",
    version: KNOWLEDGE_VERSION,
    channels: ["mobile_app"],
    audiences: ["verified_customer"],
  },
  {
    key: "physical-activity",
    title: "Physical activity and diabetes",
    content: "Regular physical activity can help manage blood glucose and reduce cardiovascular risk. Activity can also lower glucose, so people using insulin or medicines that can cause lows should discuss safe monitoring and planning with their care team.",
    contentHi: "नियमित शारीरिक गतिविधि रक्त ग्लूकोज़ प्रबंधन और हृदय संबंधी जोखिम कम करने में मदद कर सकती है। गतिविधि ग्लूकोज़ को कम भी कर सकती है, इसलिए इंसुलिन या लो शुगर करने वाली दवाएँ लेने वाले लोगों को सुरक्षित निगरानी और योजना के लिए अपनी देखभाल टीम से बात करनी चाहिए।",
    keywords: ["activity", "exercise", "walking", "walk", "active", "workout", "व्यायाम", "चलना", "गतिविधि"],
    sourceName: "CDC Get Active",
    sourceUrl: "https://www.cdc.gov/diabetes/living-with/physical-activity.html",
    version: KNOWLEDGE_VERSION,
    channels: ["mobile_app"],
    audiences: ["verified_customer"],
  },
  {
    key: "blood-sugar-management",
    title: "General blood glucose management",
    content: "Healthy eating, regular activity, maintaining a healthy weight, and tracking glucose patterns can support blood glucose management. Personal carbohydrate goals and treatment decisions should be made with the health care team.",
    contentHi: "स्वस्थ भोजन, नियमित गतिविधि, स्वस्थ वजन बनाए रखना और ग्लूकोज़ के पैटर्न पर नज़र रखना रक्त ग्लूकोज़ प्रबंधन में मदद कर सकता है। व्यक्तिगत कार्बोहाइड्रेट लक्ष्य और उपचार संबंधी निर्णय स्वास्थ्य देखभाल टीम के साथ लिए जाने चाहिए।",
    keywords: ["manage", "management", "control", "sugar", "glucose", "lifestyle", "sleep", "शुगर", "ग्लूकोज़", "नियंत्रित", "जीवनशैली", "नींद"],
    sourceName: "CDC Manage Blood Sugar",
    sourceUrl: "https://www.cdc.gov/diabetes/treatment/index.html",
    version: KNOWLEDGE_VERSION,
    channels: ["mobile_app"],
    audiences: ["verified_customer"],
  },
];

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().replace(/[^\p{L}\p{N}%\s]/gu, " ").split(/\s+/u).filter((item) => item.length >= 3));
}

export function retrieveKnowledge(question: string, limit = 3): KnowledgeEntry[] {
  const query = tokens(question.replace(/\ba1c\b/gi, "a1c hba1c"));
  return diabetesKnowledge
    .map((entry) => ({
      entry,
      score: entry.keywords.reduce((score, keyword) => {
        const matches = [...tokens(keyword)].filter((token) => query.has(token)).length;
        return score + matches;
      }, 0),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ entry }) => entry);
}
