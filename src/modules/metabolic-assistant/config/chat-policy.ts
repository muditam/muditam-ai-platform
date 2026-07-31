import type { MetabolicEnvironment } from "./env.js";
import type { AllowableChatCategory } from "../contracts/chat.js";

export const METABOLIC_CHAT_PROMPT_VERSION = "2.0.0" as const;

export interface MetabolicChatPolicy {
  enabled: boolean;
  model: string;
  allowedCategories: readonly AllowableChatCategory[];
  allowedReportStatuses: readonly ("NEEDS_REVIEW" | "READY")[];
  maxQuestionsPerWindow: number;
  maxReportsPerConversation: number;
  limitWindowMinutes: number;
  maxQuestionChars: number;
  maxHistoryMessages: number;
  maxAnswerWords: number;
  maxOutputTokens: number;
  maxKnowledgeResults: number;
  minimumMarkerConfidence: number;
  personaName: string;
  tone: string;
  responseStyle: string;
  rejectionMessage: string;
  missingReportDataMessage: string;
  safetyMessage: string;
  disclaimer: string;
  retentionDays: number;
  promptVersion: typeof METABOLIC_CHAT_PROMPT_VERSION;
}

export function buildMetabolicChatPolicy(
  environment: MetabolicEnvironment,
): MetabolicChatPolicy {
  return {
    enabled: environment.METABOLIC_CHAT_ENABLED,
    model: environment.METABOLIC_CHAT_MODEL,
    allowedCategories:
      environment.METABOLIC_CHAT_ALLOWED_CATEGORIES as AllowableChatCategory[],
    allowedReportStatuses:
      environment.METABOLIC_CHAT_ALLOWED_REPORT_STATUSES as (
        | "NEEDS_REVIEW"
        | "READY"
      )[],
    maxQuestionsPerWindow:
      environment.METABOLIC_CHAT_MAX_QUESTIONS_PER_WINDOW,
    maxReportsPerConversation:
      environment.METABOLIC_CHAT_MAX_REPORTS_PER_CONVERSATION,
    limitWindowMinutes: environment.METABOLIC_CHAT_LIMIT_WINDOW_MINUTES,
    maxQuestionChars: environment.METABOLIC_CHAT_MAX_QUESTION_CHARS,
    maxHistoryMessages: environment.METABOLIC_CHAT_MAX_HISTORY_MESSAGES,
    maxAnswerWords: environment.METABOLIC_CHAT_MAX_ANSWER_WORDS,
    maxOutputTokens: environment.METABOLIC_CHAT_MAX_OUTPUT_TOKENS,
    maxKnowledgeResults: environment.METABOLIC_CHAT_MAX_KNOWLEDGE_RESULTS,
    minimumMarkerConfidence:
      environment.METABOLIC_CHAT_MIN_MARKER_CONFIDENCE,
    personaName: environment.METABOLIC_CHAT_PERSONA_NAME,
    tone: environment.METABOLIC_CHAT_TONE,
    responseStyle: environment.METABOLIC_CHAT_RESPONSE_STYLE,
    rejectionMessage: environment.METABOLIC_CHAT_REJECTION_MESSAGE,
    missingReportDataMessage:
      environment.METABOLIC_CHAT_MISSING_REPORT_DATA_MESSAGE,
    safetyMessage: environment.METABOLIC_CHAT_SAFETY_MESSAGE,
    disclaimer: environment.METABOLIC_CHAT_DISCLAIMER,
    retentionDays: environment.METABOLIC_CHAT_RETENTION_DAYS,
    promptVersion: METABOLIC_CHAT_PROMPT_VERSION,
  };
}
