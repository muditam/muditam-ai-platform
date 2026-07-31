import { createHash } from "node:crypto";
import type {
  ChatProviderResponse,
  ReportChatProvider,
} from "../adapters/chat/chat-provider.js";
import type { MetabolicChatPolicy } from "../config/chat-policy.js";
import type { ChatCategory, ChatDecision } from "../contracts/chat.js";
import { canonicalExtractionResultSchema } from "../contracts/extraction.js";
import { MetabolicAssistantError } from "../contracts/errors.js";
import type {
  NormalizedReportContext,
  ReportComparison,
} from "../contracts/report-comparison.js";
import { normalizeExtractedReport } from "../normalization/basic-report-normalizer.js";
import { compareNormalizedReports } from "../normalization/compare-normalized-reports.js";
import type {
  ChatCitationRecord,
  ChatConversationRecord,
  ChatMessageRecord,
  ChatRepositoryPort,
} from "../repositories/chat-repository.js";
import type {
  ChatUsageRepositoryPort,
  ChatUsageReservation,
} from "../repositories/chat-usage-repository.js";
import type { ReportRepositoryPort } from "../repositories/report-repository.js";

export interface AskDiabetesChatInput {
  reportId: string;
  reportIds?: string[];
  userId: string;
  question: string;
  conversationId?: string;
}

export interface PublicChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  decision?: ChatDecision;
  category?: ChatCategory;
  citations: ChatCitationRecord[];
  createdAt: string;
}

export interface PublicChatReport {
  reportId: string;
  displayName: string;
  uploadedAt: string;
  reportReviewPending: boolean;
}

export interface AskDiabetesChatResult {
  conversationId: string;
  reportIds: string[];
  reports: PublicChatReport[];
  message: PublicChatMessage;
  remainingQuestions: number;
  limitResetsAt: string;
  disclaimer: string;
  reportReviewPending: boolean;
}

export interface DiabetesChatHistory {
  conversationId: string;
  reportId: string;
  reportIds: string[];
  messages: PublicChatMessage[];
  disclaimer: string;
}

export interface DiabetesChatOperations {
  ask(input: AskDiabetesChatInput): Promise<AskDiabetesChatResult>;
  history(input: {
    reportId: string;
    conversationId: string;
    userId: string;
  }): Promise<DiabetesChatHistory>;
}

function userKey(userId: string): string {
  return createHash("sha256").update(userId).digest("hex");
}

function expiry(now: Date, retentionDays: number): Date {
  return new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1_000);
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function limitWords(text: string, maximum: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maximum) return text.trim();
  return `${words.slice(0, maximum).join(" ")}…`;
}

function publicMessage(message: ChatMessageRecord): PublicChatMessage {
  const result: PublicChatMessage = {
    id: message.id,
    role: message.role,
    content: message.content,
    citations: message.citations,
    createdAt: message.createdAt.toISOString(),
  };
  if (message.decision !== undefined) result.decision = message.decision;
  if (message.category !== undefined) result.category = message.category;
  return result;
}

function publicReport(context: NormalizedReportContext): PublicChatReport {
  return {
    reportId: context.reportId,
    displayName: context.displayName,
    uploadedAt: context.uploadedAt,
    reportReviewPending: context.normalized.reportReviewPending,
  };
}

export class DiabetesChatService implements DiabetesChatOperations {
  readonly #allowedCategories: ReadonlySet<ChatCategory>;
  readonly #allowedReportStatuses: ReadonlySet<string>;

  constructor(
    private readonly reports: ReportRepositoryPort,
    private readonly chats: ChatRepositoryPort,
    private readonly usage: ChatUsageRepositoryPort,
    private readonly provider: ReportChatProvider,
    private readonly policy: MetabolicChatPolicy,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.#allowedCategories = new Set(policy.allowedCategories);
    this.#allowedReportStatuses = new Set(policy.allowedReportStatuses);
  }

  async ask(input: AskDiabetesChatInput): Promise<AskDiabetesChatResult> {
    this.assertEnabled();
    const question = input.question.trim();
    const normalizedUserId = this.validateUserId(input.userId);
    if (
      question.length === 0 ||
      question.length > this.policy.maxQuestionChars
    ) {
      throw new MetabolicAssistantError(
        "INVALID_CHAT_QUESTION",
        `question must contain 1 to ${this.policy.maxQuestionChars} characters.`,
        { status: 400 },
      );
    }

    const key = userKey(normalizedUserId);
    const existingConversation =
      input.conversationId === undefined
        ? undefined
        : await this.ownedConversation(
            input.conversationId,
            input.reportId,
            key,
          );
    const selectedReportIds = unique([
      input.reportId,
      ...(existingConversation?.reportIds ?? []),
      ...(input.reportIds ?? []),
    ]);
    if (selectedReportIds.length > this.policy.maxReportsPerConversation) {
      throw new MetabolicAssistantError(
        "CHAT_REPORT_LIMIT_EXCEEDED",
        "This conversation has reached its report limit.",
        {
          status: 400,
          details: {
            maximum: this.policy.maxReportsPerConversation,
            requested: selectedReportIds.length,
          },
        },
      );
    }

    const contexts = await this.loadReportContexts(
      selectedReportIds,
      normalizedUserId,
    );
    const comparison = compareNormalizedReports(contexts);
    const conversation =
      existingConversation === undefined
        ? undefined
        : await this.chats.attachReports(
            existingConversation.id,
            selectedReportIds,
            this.policy.maxReportsPerConversation,
          );
    const history =
      conversation === undefined
        ? []
        : await this.chats.recentMessages(
            conversation.id,
            this.policy.maxHistoryMessages,
          );

    const reservation = await this.usage.reserve({
      userKey: key,
      now: this.now(),
      windowMinutes: this.policy.limitWindowMinutes,
      maximum: this.policy.maxQuestionsPerWindow,
    });
    if (!reservation.accepted) {
      throw new MetabolicAssistantError(
        "CHAT_RATE_LIMITED",
        "The question limit has been reached for this time window.",
        {
          status: 429,
          details: { resetsAt: reservation.resetsAt.toISOString() },
        },
      );
    }

    let providerResponse: ChatProviderResponse;
    try {
      providerResponse = await this.provider.answer({
        question,
        reports: contexts,
        comparison,
        history: history.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      });
    } catch (error) {
      await this.releaseReservation(key, reservation).catch(() => undefined);
      throw error;
    }

    const enforced = this.enforceProviderResult(
      providerResponse,
      contexts,
      comparison,
    );
    const expiresAt = expiry(this.now(), this.policy.retentionDays);
    const activeConversation =
      conversation ??
      (await this.chats.createConversation({
        reportId: input.reportId,
        reportIds: selectedReportIds,
        userKey: key,
        expiresAt,
      }));
    const saved = await this.chats.saveExchange({
      conversationId: activeConversation.id,
      reportId: input.reportId,
      userKey: key,
      question,
      answer: enforced.answer,
      decision: enforced.decision,
      category: enforced.category,
      citations: enforced.citations,
      model: providerResponse.model,
      ...(providerResponse.responseId === undefined
        ? {}
        : { responseId: providerResponse.responseId }),
      promptVersion: this.policy.promptVersion,
      expiresAt,
    });

    return {
      conversationId: activeConversation.id,
      reportIds: selectedReportIds,
      reports: contexts.map(publicReport),
      message: publicMessage(saved),
      remainingQuestions: reservation.remaining,
      limitResetsAt: reservation.resetsAt.toISOString(),
      disclaimer: this.policy.disclaimer,
      reportReviewPending: contexts.some(
        (context) => context.normalized.reportReviewPending,
      ),
    };
  }

  async history(input: {
    reportId: string;
    conversationId: string;
    userId: string;
  }): Promise<DiabetesChatHistory> {
    this.assertEnabled();
    const normalizedUserId = this.validateUserId(input.userId);
    const conversation = await this.ownedConversation(
      input.conversationId,
      input.reportId,
      userKey(normalizedUserId),
    );
    return {
      conversationId: conversation.id,
      reportId: conversation.reportId,
      reportIds: conversation.reportIds,
      messages: (await this.chats.allMessages(conversation.id)).map(
        publicMessage,
      ),
      disclaimer: this.policy.disclaimer,
    };
  }

  private assertEnabled(): void {
    if (!this.policy.enabled) {
      throw new MetabolicAssistantError(
        "CHAT_DISABLED",
        "Diabetes chat is disabled.",
        { status: 503 },
      );
    }
  }

  private validateUserId(value: string): string {
    const normalized = value.trim();
    if (normalized.length === 0 || normalized.length > 200) {
      throw new MetabolicAssistantError(
        "INVALID_CHAT_QUESTION",
        "userId is required.",
        { status: 400 },
      );
    }
    return normalized;
  }

  private async loadReportContexts(
    reportIds: readonly string[],
    userId: string,
  ): Promise<NormalizedReportContext[]> {
    return Promise.all(
      reportIds.map(async (reportId) => {
        const report = await this.reports.getById(reportId);
        if (
          report.subjectId !== undefined &&
          report.subjectId !== userId
        ) {
          throw new MetabolicAssistantError(
            "REPORT_NOT_FOUND",
            "Report not found.",
            { status: 404 },
          );
        }
        if (
          !this.#allowedReportStatuses.has(report.status) ||
          report.extraction === null
        ) {
          throw new MetabolicAssistantError(
            "CHAT_REPORT_NOT_READY",
            "Every selected report must finish extraction before chat can use it.",
            { status: 409, details: { reportId } },
          );
        }
        const extraction = canonicalExtractionResultSchema.safeParse(
          report.extraction,
        );
        if (!extraction.success) {
          throw new MetabolicAssistantError(
            "CHAT_REPORT_NOT_READY",
            "A selected report extraction is not valid for chat.",
            { status: 409, details: { reportId } },
          );
        }
        return {
          reportId: report.id,
          displayName: report.displayName,
          uploadedAt: report.createdAt.toISOString(),
          normalized: normalizeExtractedReport(extraction.data, {
            minimumConfidence: this.policy.minimumMarkerConfidence,
          }),
        };
      }),
    );
  }

  private async ownedConversation(
    conversationId: string,
    reportId: string,
    key: string,
  ): Promise<ChatConversationRecord> {
    const conversation = await this.chats.getConversation(conversationId);
    if (
      conversation.reportId !== reportId ||
      conversation.userKey !== key ||
      conversation.status !== "ACTIVE"
    ) {
      throw new MetabolicAssistantError(
        "CHAT_CONVERSATION_NOT_FOUND",
        "Chat conversation not found.",
        { status: 404 },
      );
    }
    return conversation;
  }

  private enforceProviderResult(
    providerResponse: ChatProviderResponse,
    contexts: readonly NormalizedReportContext[],
    comparison: ReportComparison,
  ): {
    answer: string;
    decision: ChatDecision;
    category: ChatCategory;
    citations: ChatCitationRecord[];
  } {
    const providerResult = providerResponse.result;
    const markerByKey = new Map<
      string,
      {
        context: NormalizedReportContext;
        marker: NormalizedReportContext["normalized"]["biomarkers"][number];
      }
    >();
    for (const context of contexts) {
      for (const marker of context.normalized.biomarkers) {
        if (marker.canonicalCode === "other") continue;
        markerByKey.set(`${context.reportId}:${marker.id}`, {
          context,
          marker,
        });
      }
    }

    const citations: ChatCitationRecord[] = [];
    const seen = new Set<string>();
    for (const cited of providerResult.citedBiomarkers) {
      const key = `${cited.reportId}:${cited.biomarkerId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const found = markerByKey.get(key);
      if (found === undefined) continue;
      const citation: ChatCitationRecord = {
        reportId: found.context.reportId,
        reportName: found.context.displayName,
        biomarkerId: found.marker.id,
        label: found.marker.displayLabel,
        value: found.marker.value,
      };
      if (found.marker.normalizedUnit !== undefined) {
        citation.unit = found.marker.normalizedUnit;
      }
      if (found.marker.sourcePage !== undefined) {
        citation.page = found.marker.sourcePage;
      }
      citations.push(citation);
    }

    if (
      providerResult.decision === "SAFETY" ||
      providerResult.category === "URGENT_SAFETY"
    ) {
      return {
        answer: this.policy.safetyMessage,
        decision: "SAFETY",
        category: "URGENT_SAFETY",
        citations: [],
      };
    }
    if (
      providerResult.decision !== "ALLOW" ||
      !this.#allowedCategories.has(providerResult.category)
    ) {
      return {
        answer: this.policy.rejectionMessage,
        decision: "REFUSE",
        category: providerResult.category,
        citations: [],
      };
    }
    const citedReportCount = new Set(
      citations.map((citation) => citation.reportId),
    ).size;
    if (
      providerResult.category === "REPORT_VALUES" &&
      (!providerResult.usedReportData || citations.length === 0)
    ) {
      return this.missingReportData("REPORT_VALUES");
    }
    if (
      providerResult.category === "REPORT_COMPARISON" &&
      (
        contexts.length < 2 ||
        comparison.biomarkers.length === 0 ||
        !providerResult.usedReportData ||
        citedReportCount < 2
      )
    ) {
      return this.missingReportData("REPORT_COMPARISON");
    }
    if (providerResult.answer.trim().length === 0) {
      return {
        answer: this.policy.rejectionMessage,
        decision: "REFUSE",
        category: providerResult.category,
        citations: [],
      };
    }
    return {
      answer: limitWords(
        providerResult.answer,
        this.policy.maxAnswerWords,
      ),
      decision: "ALLOW",
      category: providerResult.category,
      citations,
    };
  }

  private missingReportData(category: ChatCategory): {
    answer: string;
    decision: ChatDecision;
    category: ChatCategory;
    citations: ChatCitationRecord[];
  } {
    return {
      answer: this.policy.missingReportDataMessage,
      decision: "REFUSE",
      category,
      citations: [],
    };
  }

  private async releaseReservation(
    key: string,
    reservation: ChatUsageReservation,
  ): Promise<void> {
    await this.usage.release({
      userKey: key,
      windowStart: reservation.windowStart,
    });
  }
}
