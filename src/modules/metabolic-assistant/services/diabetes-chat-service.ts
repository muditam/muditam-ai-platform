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
  KnowledgeReferenceRecord,
} from "../repositories/chat-repository.js";
import type {
  ChatUsageRepositoryPort,
  ChatUsageReservation,
} from "../repositories/chat-usage-repository.js";
import type {
  KnowledgeRecord,
  KnowledgeRepositoryPort,
} from "../repositories/knowledge-repository.js";
import type { ReportRepositoryPort } from "../repositories/report-repository.js";

export interface PublicConversation {
  conversationId: string;
  reportIds: string[];
  status: "ACTIVE" | "CLOSED";
  createdAt: string;
  updatedAt: string;
}

export interface PublicChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  decision?: ChatDecision;
  category?: ChatCategory;
  citations: ChatCitationRecord[];
  knowledgeReferences: KnowledgeReferenceRecord[];
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
  attachedReportIds: string[];
  readyReports: PublicChatReport[];
  message: PublicChatMessage;
  remainingQuestions: number;
  limitResetsAt: string;
  disclaimer: string;
}

export interface DiabetesChatHistory {
  conversation: PublicConversation;
  messages: PublicChatMessage[];
  disclaimer: string;
}

export interface DiabetesChatOperations {
  createConversation(userId: string): Promise<PublicConversation>;
  listConversations(userId: string): Promise<PublicConversation[]>;
  ask(input: {
    conversationId: string;
    userId: string;
    question: string;
  }): Promise<AskDiabetesChatResult>;
  history(input: {
    conversationId: string;
    userId: string;
  }): Promise<DiabetesChatHistory>;
}

export interface ConversationReportAttachmentOperations {
  attachReport(input: {
    conversationId: string;
    userId: string;
    reportId: string;
  }): Promise<PublicConversation>;
  detachReport(input: {
    conversationId: string;
    userId: string;
    reportId: string;
  }): Promise<void>;
  detachReportEverywhere(reportId: string): Promise<void>;
}

function userKey(userId: string): string {
  return createHash("sha256").update(userId).digest("hex");
}

function expiry(now: Date, retentionDays: number): Date {
  return new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1_000);
}

function limitWords(text: string, maximum: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maximum) return text.trim();
  return `${words.slice(0, maximum).join(" ")}…`;
}

function publicConversation(
  conversation: ChatConversationRecord,
): PublicConversation {
  return {
    conversationId: conversation.id,
    reportIds: conversation.reportIds,
    status: conversation.status,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  };
}

function publicMessage(message: ChatMessageRecord): PublicChatMessage {
  const result: PublicChatMessage = {
    id: message.id,
    role: message.role,
    content: message.content,
    citations: message.citations,
    knowledgeReferences: message.knowledgeReferences,
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

export class DiabetesChatService
  implements DiabetesChatOperations, ConversationReportAttachmentOperations
{
  readonly #allowedCategories: ReadonlySet<ChatCategory>;
  readonly #allowedReportStatuses: ReadonlySet<string>;

  constructor(
    private readonly reports: ReportRepositoryPort,
    private readonly chats: ChatRepositoryPort,
    private readonly usage: ChatUsageRepositoryPort,
    private readonly knowledge: KnowledgeRepositoryPort,
    private readonly provider: ReportChatProvider,
    private readonly policy: MetabolicChatPolicy,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.#allowedCategories = new Set(policy.allowedCategories);
    this.#allowedReportStatuses = new Set(policy.allowedReportStatuses);
  }

  async createConversation(userId: string): Promise<PublicConversation> {
    this.assertEnabled();
    const normalizedUserId = this.validateUserId(userId);
    return publicConversation(
      await this.chats.createConversation({
        userKey: userKey(normalizedUserId),
        expiresAt: expiry(this.now(), this.policy.retentionDays),
      }),
    );
  }

  async listConversations(userId: string): Promise<PublicConversation[]> {
    this.assertEnabled();
    const normalizedUserId = this.validateUserId(userId);
    return (
      await this.chats.listConversations(userKey(normalizedUserId), 100)
    ).map(publicConversation);
  }

  async ask(input: {
    conversationId: string;
    userId: string;
    question: string;
  }): Promise<AskDiabetesChatResult> {
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
    const conversation = await this.ownedConversation(
      input.conversationId,
      key,
    );
    const contexts = await this.loadReadyReportContexts(
      conversation.reportIds,
      normalizedUserId,
    );
    const comparison = compareNormalizedReports(contexts);
    const knowledge = await this.knowledge.search(
      question,
      this.policy.maxKnowledgeResults,
    );
    const history = await this.chats.recentMessages(
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
        knowledge,
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
      knowledge,
    );
    const saved = await this.chats.saveExchange({
      conversationId: conversation.id,
      userKey: key,
      question,
      answer: enforced.answer,
      decision: enforced.decision,
      category: enforced.category,
      citations: enforced.citations,
      knowledgeReferences: enforced.knowledgeReferences,
      model: providerResponse.model,
      ...(providerResponse.responseId === undefined
        ? {}
        : { responseId: providerResponse.responseId }),
      promptVersion: this.policy.promptVersion,
      expiresAt: expiry(this.now(), this.policy.retentionDays),
    });

    return {
      conversationId: conversation.id,
      attachedReportIds: conversation.reportIds,
      readyReports: contexts.map(publicReport),
      message: publicMessage(saved),
      remainingQuestions: reservation.remaining,
      limitResetsAt: reservation.resetsAt.toISOString(),
      disclaimer: this.policy.disclaimer,
    };
  }

  async history(input: {
    conversationId: string;
    userId: string;
  }): Promise<DiabetesChatHistory> {
    this.assertEnabled();
    const normalizedUserId = this.validateUserId(input.userId);
    const conversation = await this.ownedConversation(
      input.conversationId,
      userKey(normalizedUserId),
    );
    return {
      conversation: publicConversation(conversation),
      messages: (await this.chats.allMessages(conversation.id)).map(
        publicMessage,
      ),
      disclaimer: this.policy.disclaimer,
    };
  }

  async attachReport(input: {
    conversationId: string;
    userId: string;
    reportId: string;
  }): Promise<PublicConversation> {
    this.assertEnabled();
    const normalizedUserId = this.validateUserId(input.userId);
    const conversation = await this.ownedConversation(
      input.conversationId,
      userKey(normalizedUserId),
    );
    return publicConversation(
      await this.chats.attachReports(
        conversation.id,
        [input.reportId],
        this.policy.maxReportsPerConversation,
      ),
    );
  }

  async detachReport(input: {
    conversationId: string;
    userId: string;
    reportId: string;
  }): Promise<void> {
    const normalizedUserId = this.validateUserId(input.userId);
    const conversation = await this.ownedConversation(
      input.conversationId,
      userKey(normalizedUserId),
    );
    await this.chats.detachReport(conversation.id, input.reportId);
  }

  async detachReportEverywhere(reportId: string): Promise<void> {
    await this.chats.detachReportEverywhere(reportId);
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

  private async ownedConversation(
    conversationId: string,
    key: string,
  ): Promise<ChatConversationRecord> {
    const conversation = await this.chats.getConversation(conversationId);
    if (
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

  private async loadReadyReportContexts(
    reportIds: readonly string[],
    userId: string,
  ): Promise<NormalizedReportContext[]> {
    const contexts: NormalizedReportContext[] = [];
    for (const reportId of reportIds) {
      const report = await this.reports.getById(reportId);
      if (report.subjectId !== undefined && report.subjectId !== userId) {
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
        continue;
      }
      const extraction = canonicalExtractionResultSchema.safeParse(
        report.extraction,
      );
      if (!extraction.success) continue;
      contexts.push({
        reportId: report.id,
        displayName: report.displayName,
        uploadedAt: report.createdAt.toISOString(),
        normalized: normalizeExtractedReport(extraction.data, {
          minimumConfidence: this.policy.minimumMarkerConfidence,
        }),
      });
    }
    return contexts;
  }

  private enforceProviderResult(
    providerResponse: ChatProviderResponse,
    contexts: readonly NormalizedReportContext[],
    comparison: ReportComparison,
    knowledge: readonly KnowledgeRecord[],
  ): {
    answer: string;
    decision: ChatDecision;
    category: ChatCategory;
    citations: ChatCitationRecord[];
    knowledgeReferences: KnowledgeReferenceRecord[];
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
    const seenCitations = new Set<string>();
    for (const cited of providerResult.citedBiomarkers) {
      const key = `${cited.reportId}:${cited.biomarkerId}`;
      if (seenCitations.has(key)) continue;
      seenCitations.add(key);
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

    const knowledgeById = new Map(
      knowledge.map((entry) => [entry.id, entry]),
    );
    const knowledgeReferences: KnowledgeReferenceRecord[] = [];
    for (const id of new Set(providerResult.citedKnowledgeIds)) {
      const entry = knowledgeById.get(id);
      if (entry === undefined) continue;
      knowledgeReferences.push({
        knowledgeId: entry.id,
        key: entry.key,
        title: entry.title,
        sourceName: entry.source.name,
        sourceUrl: entry.source.url,
      });
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
        knowledgeReferences,
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
        knowledgeReferences: [],
      };
    }
    if (
      providerResult.category === "REPORT_VALUES" &&
      (!providerResult.usedReportData || citations.length === 0)
    ) {
      return this.missingReportData("REPORT_VALUES");
    }
    const citedReportCount = new Set(
      citations.map((citation) => citation.reportId),
    ).size;
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
        knowledgeReferences: [],
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
      knowledgeReferences,
    };
  }

  private missingReportData(category: ChatCategory): {
    answer: string;
    decision: ChatDecision;
    category: ChatCategory;
    citations: ChatCitationRecord[];
    knowledgeReferences: KnowledgeReferenceRecord[];
  } {
    return {
      answer: this.policy.missingReportDataMessage,
      decision: "REFUSE",
      category,
      citations: [],
      knowledgeReferences: [],
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
