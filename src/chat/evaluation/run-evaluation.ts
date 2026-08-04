import process from "node:process";
import { answerChat } from "../chat-engine.js";
import { chatEvaluationCases } from "./cases.js";

const observations = [
  { observationId: "eval-hba1c", reportId: "eval-report", canonicalCode: "HBA1C", displayName: "HbA1c", value: { type: "NUMERIC", numeric: 10 }, unit: "%" },
  { observationId: "eval-fasting-glucose", reportId: "eval-report", canonicalCode: "GLUCOSE_FASTING", displayName: "Fasting glucose", value: { type: "NUMERIC", numeric: 140 }, unit: "mg/dL" },
];

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.env.MUDITAM_RUN_LIVE_CHAT_EVAL !== "true") {
  console.error("Live evaluation is disabled. Set MUDITAM_RUN_LIVE_CHAT_EVAL=true to acknowledge billable OpenAI calls.");
  process.exit(2);
}
if (!(process.env.MUDITAM_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY)) {
  console.error("MUDITAM_OPENAI_API_KEY is required.");
  process.exit(2);
}

const requestedGroup = argument("--group")?.toUpperCase();
const requestedLimit = Number(argument("--limit") ?? chatEvaluationCases.length);
const selected = chatEvaluationCases
  .filter((item) => !requestedGroup || item.group === requestedGroup)
  .slice(0, Number.isFinite(requestedLimit) ? requestedLimit : chatEvaluationCases.length);

let passed = 0;
let totalTokens = 0;
const failures: Array<Record<string, unknown>> = [];

for (const item of selected) {
  try {
    const response = await answerChat({
      conversationId: `evaluation-${item.id}`,
      message: item.message,
      language: item.language,
      observations,
      recentMessages: [],
    });
    totalTokens += response.usage.totalTokens;
    const citationCodes = response.citations.map((citation) =>
      observations.find((observation) => observation.observationId === citation.observationId)?.canonicalCode,
    );
    const reasons: string[] = [];
    if (response.decision !== item.expectedDecision) reasons.push(`decision=${response.decision}`);
    if (!item.expectedCategories.includes(response.category)) reasons.push(`category=${response.category}`);
    if (item.requiredCitation && !citationCodes.includes(item.requiredCitation)) reasons.push(`missingCitation=${item.requiredCitation}`);
    const lowerAnswer = response.answer.toLowerCase();
    const forbidden = item.forbiddenTerms.find((term) => lowerAnswer.includes(term.toLowerCase()));
    if (forbidden) reasons.push(`forbiddenTerm=${forbidden}`);
    if (reasons.length) failures.push({ id: item.id, reasons, model: response.model, guardrailStage: response.guardrailStage });
    else passed += 1;
  } catch (error) {
    failures.push({ id: item.id, reasons: [error instanceof Error ? error.message : "unknown error"] });
  }
}

const summary = {
  corpusVersion: "2026-08-04.1",
  reviewStatus: "DRAFT",
  selected: selected.length,
  passed,
  failed: failures.length,
  passRate: selected.length ? Number((passed / selected.length).toFixed(4)) : 0,
  totalTokens,
  failures,
};
console.log(JSON.stringify(summary, null, 2));
if (failures.length) process.exitCode = 1;
