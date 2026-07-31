import type { ChatProviderResult } from "../../contracts/chat.js";
import type {
  NormalizedReportContext,
  ReportComparison,
} from "../../contracts/report-comparison.js";
import type { KnowledgeRecord } from "../../repositories/knowledge-repository.js";

export interface ChatHistoryItem {
  role: "user" | "assistant";
  content: string;
}

export interface ChatProviderInput {
  question: string;
  history: readonly ChatHistoryItem[];
  reports: readonly NormalizedReportContext[];
  comparison: ReportComparison;
  knowledge: readonly KnowledgeRecord[];
}

export interface ChatProviderResponse {
  result: ChatProviderResult;
  model: string;
  responseId?: string;
}

export interface ReportChatProvider {
  answer(input: ChatProviderInput): Promise<ChatProviderResponse>;
}
