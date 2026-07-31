import type { DiabetesKnowledgeEntry } from "../contracts/knowledge.js";

export const DIABETES_KNOWLEDGE_VERSION = "1.0.0" as const;

export const DIABETES_KNOWLEDGE_ENTRIES: readonly DiabetesKnowledgeEntry[] = [
  {
    key: "what-is-diabetes",
    title: "What diabetes means",
    category: "DIABETES_BASICS",
    content:
      "Diabetes is a long-term condition in which blood glucose is too high because the body does not make enough insulin, does not use insulin well, or both. A healthcare professional uses symptoms, history, and appropriate tests to diagnose it.",
    keywords: [
      "diabetes",
      "what is diabetes",
      "blood sugar disease",
      "insulin",
    ],
    source: {
      name: "CDC Diabetes Basics",
      url: "https://www.cdc.gov/diabetes/about/index.html",
      reviewedAt: "2026-07-31",
    },
    version: DIABETES_KNOWLEDGE_VERSION,
    active: true,
  },
  {
    key: "hba1c-ranges",
    title: "HbA1c meaning and general ranges",
    category: "GLYCEMIC_TESTS",
    content:
      "HbA1c estimates average blood glucose over about the past two to three months. General diagnostic ranges are: below 5.7% is normal, 5.7% to 6.4% is in the prediabetes range, and 6.5% or above is in the diabetes range. One value alone should not be treated as a personal diagnosis; a healthcare professional decides whether confirmation or another test is needed.",
    keywords: [
      "hba1c",
      "a1c",
      "h1b",
      "hemoglobin a1c",
      "glycated hemoglobin",
      "a1c range",
      "normal a1c",
    ],
    source: {
      name: "CDC A1C Test for Diabetes and Prediabetes",
      url: "https://www.cdc.gov/diabetes/diabetes-testing/prediabetes-a1c-test.html",
      reviewedAt: "2026-07-31",
    },
    version: DIABETES_KNOWLEDGE_VERSION,
    active: true,
  },
  {
    key: "fasting-glucose-ranges",
    title: "Fasting glucose screening ranges",
    category: "GLYCEMIC_TESTS",
    content:
      "For fasting plasma glucose screening, below 100 mg/dL is generally normal, 100 to 125 mg/dL is in the prediabetes range, and 126 mg/dL or above is in the diabetes range. Diagnosis normally needs clinical review and may need repeat or additional testing.",
    keywords: [
      "fasting glucose",
      "fasting blood sugar",
      "fbs",
      "fasting range",
      "glucose range",
    ],
    source: {
      name: "CDC Diabetes Testing",
      url: "https://www.cdc.gov/diabetes/diabetes-testing/index.html",
      reviewedAt: "2026-07-31",
    },
    version: DIABETES_KNOWLEDGE_VERSION,
    active: true,
  },
  {
    key: "typical-glucose-targets",
    title: "Typical glucose targets for people with diabetes",
    category: "GLUCOSE_TARGETS",
    content:
      "Typical blood glucose targets for many people with diabetes are 80 to 130 mg/dL before a meal and below 180 mg/dL two hours after the start of a meal. Personal targets can differ with age, pregnancy, medicines, other health conditions, and a clinician's plan.",
    keywords: [
      "glucose target",
      "blood sugar target",
      "before meal",
      "after meal",
      "post meal",
      "ppbs",
    ],
    source: {
      name: "CDC Manage Blood Sugar",
      url: "https://www.cdc.gov/diabetes/treatment/index.html",
      reviewedAt: "2026-07-31",
    },
    version: DIABETES_KNOWLEDGE_VERSION,
    active: true,
  },
  {
    key: "low-blood-sugar",
    title: "Low blood sugar",
    category: "SAFETY",
    content:
      "Blood glucose below 70 mg/dL is considered low. Low blood sugar can become urgent, especially with confusion, loss of consciousness, seizures, or inability to swallow. A person with severe symptoms needs immediate local medical help.",
    keywords: [
      "low blood sugar",
      "hypoglycemia",
      "below 70",
      "shaking",
      "confusion",
      "unconscious",
    ],
    source: {
      name: "CDC Low Blood Sugar",
      url: "https://www.cdc.gov/diabetes/about/low-blood-sugar-hypoglycemia.html",
      reviewedAt: "2026-07-31",
    },
    version: DIABETES_KNOWLEDGE_VERSION,
    active: true,
  },
];
