import { describe, expect, it } from "vitest";
import type {
  ChatProviderInput,
  ChatProviderResponse,
  ReportChatProvider,
} from "../../src/modules/metabolic-assistant/adapters/chat/chat-provider.js";
import { buildMetabolicChatPolicy } from "../../src/modules/metabolic-assistant/config/chat-policy.js";
import { loadMetabolicEnvironment } from "../../src/modules/metabolic-assistant/config/env.js";
import type { CanonicalExtractionResult } from "../../src/modules/metabolic-assistant/contracts/extraction.js";
import type {
  ChatConversationRecord,
  ChatMessageRecord,
  ChatRepositoryPort,
  SaveChatExchangeInput,
} from "../../src/modules/metabolic-assistant/repositories/chat-repository.js";
import type {
  ChatUsageRepositoryPort,
  ChatUsageReservation,
} from "../../src/modules/metabolic-assistant/repositories/chat-usage-repository.js";
import type {
  KnowledgeRecord,
  KnowledgeRepositoryPort,
} from "../../src/modules/metabolic-assistant/repositories/knowledge-repository.js";
import type {
  CreateQueuedReportRecord,
  ReportRecord,
  ReportRepositoryPort,
} from "../../src/modules/metabolic-assistant/repositories/report-repository.js";
import { DiabetesChatService } from "../../src/modules/metabolic-assistant/services/diabetes-chat-service.js";

const reportId = "507f1f77bcf86cd799439011";
const conversationId = "507f1f77bcf86cd799439012";
const now = new Date("2026-07-31T00:00:00.000Z");
const extraction: CanonicalExtractionResult = {
  schemaVersion: "1.0.0",
  reportId,
  provider: { kind: "test", name: "fixture", version: "1" },
  source: {
    fileName: "report.pdf",
    mimeType: "application/pdf",
    sha256: "a".repeat(64),
  },
  biomarkers: [
    {
      id: "hba1c-1",
      canonicalCode: "hba1c",
      panel: "GLYCEMIC",
      sourceLabel: "HbA1c",
      numericValue: 6.4,
      unit: "%",
      status: "HIGH",
      confidence: 0.98,
      sourcePage: 1,
      reviewState: "UNREVIEWED",
    },
  ],
  warnings: [],
  extractedAt: now.toISOString(),
};

const hba1cKnowledge: KnowledgeRecord = {
  id: "507f1f77bcf86cd799439099",
  key: "hba1c-ranges",
  title: "HbA1c meaning and screening ranges",
  category: "DIABETES_TESTING",
  content: "HbA1c below 5.7% is normal; 5.7% to 6.4% is prediabetes.",
  source: {
    name: "CDC",
    url: "https://www.cdc.gov/diabetes/diabetes-testing/prediabetes-a1c-test.html",
    reviewedAt: "2026-07-31",
  },
  version: "1.0.0",
};

class FakeReportRepository implements ReportRepositoryPort {
  createId(): string {
    return reportId;
  }
  async createQueued(_input: CreateQueuedReportRecord): Promise<ReportRecord> {
    throw new Error("Not used.");
  }
  async getById(): Promise<ReportRecord> {
    return {
      id: reportId,
      subjectId: "test-user",
      displayName: "report.pdf",
      status: "NEEDS_REVIEW",
      file: {
        originalName: "report.pdf",
        mimeType: "application/pdf",
        byteSize: 100,
        sha256: "a".repeat(64),
        storageProvider: "local",
        objectKey: "report.pdf",
      },
      extraction,
      createdAt: now,
      updatedAt: now,
    };
  }
  async countBySubjectId(): Promise<number> {
    return 0;
  }
  async list(): Promise<ReportRecord[]> {
    return [];
  }
  async deleteById(): Promise<ReportRecord> {
    throw new Error("Not used.");
  }
}

class FakeChatRepository implements ChatRepositoryPort {
  saved?: SaveChatExchangeInput;
  conversation?: ChatConversationRecord;

  async createConversation(input: {
    userKey: string;
    expiresAt: Date;
  }): Promise<ChatConversationRecord> {
    this.conversation = {
      id: conversationId,
      reportIds: [],
      userKey: input.userKey,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    };
    return this.conversation;
  }
  async getConversation(): Promise<ChatConversationRecord> {
    if (this.conversation === undefined) throw new Error("Missing conversation.");
    return this.conversation;
  }
  async listConversations(): Promise<ChatConversationRecord[]> {
    return this.conversation === undefined ? [] : [this.conversation];
  }
  async attachReports(
    _conversationId: string,
    reportIds: string[],
    maximum: number,
  ): Promise<ChatConversationRecord> {
    if (this.conversation === undefined) throw new Error("Missing conversation.");
    const combined = [...new Set([...this.conversation.reportIds, ...reportIds])];
    if (combined.length > maximum) throw new Error("Too many reports.");
    this.conversation = { ...this.conversation, reportIds: combined };
    return this.conversation;
  }
  async detachReport(_conversationId: string, id: string): Promise<void> {
    if (this.conversation !== undefined) {
      this.conversation = {
        ...this.conversation,
        reportIds: this.conversation.reportIds.filter((value) => value !== id),
      };
    }
  }
  async detachReportEverywhere(id: string): Promise<void> {
    await this.detachReport(conversationId, id);
  }
  async recentMessages(): Promise<ChatMessageRecord[]> {
    return [];
  }
  async allMessages(): Promise<ChatMessageRecord[]> {
    return [];
  }
  async saveExchange(input: SaveChatExchangeInput): Promise<ChatMessageRecord> {
    this.saved = input;
    return {
      id: "507f1f77bcf86cd799439013",
      conversationId: input.conversationId,
      userKey: input.userKey,
      role: "assistant",
      content: input.answer,
      decision: input.decision,
      category: input.category,
      citations: input.citations,
      knowledgeReferences: input.knowledgeReferences,
      createdAt: now,
    };
  }
}

class FakeUsageRepository implements ChatUsageRepositoryPort {
  constructor(private readonly accepted = true) {}

  async reserve(): Promise<ChatUsageReservation> {
    return {
      accepted: this.accepted,
      remaining: this.accepted ? 19 : 0,
      windowStart: now,
      resetsAt: new Date("2026-08-01T00:00:00.000Z"),
    };
  }
  async release(): Promise<void> {}
}

class FakeKnowledgeRepository implements KnowledgeRepositoryPort {
  receivedQuestion?: string;
  constructor(private readonly values: KnowledgeRecord[] = []) {}
  async search(question: string): Promise<KnowledgeRecord[]> {
    this.receivedQuestion = question;
    return this.values;
  }
}

class FakeProvider implements ReportChatProvider {
  received?: ChatProviderInput;
  constructor(private readonly response: ChatProviderResponse) {}
  async answer(input: ChatProviderInput): Promise<ChatProviderResponse> {
    this.received = input;
    return this.response;
  }
}

function policy() {
  return buildMetabolicChatPolicy(
    loadMetabolicEnvironment({
      NODE_ENV: "test",
      ENABLE_METABOLIC_ASSISTANT: "true",
      METABOLIC_CHAT_ENABLED: "true",
    }),
  );
}

async function createService(
  provider: FakeProvider,
  options: {
    chats?: FakeChatRepository;
    usage?: FakeUsageRepository;
    knowledge?: FakeKnowledgeRepository;
  } = {},
) {
  const chats = options.chats ?? new FakeChatRepository();
  const service = new DiabetesChatService(
    new FakeReportRepository(),
    chats,
    options.usage ?? new FakeUsageRepository(),
    options.knowledge ?? new FakeKnowledgeRepository(),
    provider,
    policy(),
    () => now,
  );
  await service.createConversation("test-user");
  return { service, chats };
}

describe("diabetes chat service", () => {
  it("creates a conversation and answers a greeting without any report", async () => {
    const provider = new FakeProvider({
      model: "test-model",
      result: {
        decision: "ALLOW",
        category: "GREETING",
        answer: "Hi! How can I help with diabetes today?",
        citedBiomarkers: [],
        citedKnowledgeIds: [],
        usedReportData: false,
        usedKnowledgeBase: false,
      },
    });
    const { service } = await createService(provider);

    const result = await service.ask({
      conversationId,
      userId: "test-user",
      question: "Hi",
    });

    expect(result.attachedReportIds).toEqual([]);
    expect(result.readyReports).toEqual([]);
    expect(result.message.category).toBe("GREETING");
    expect(provider.received?.reports).toEqual([]);
  });

  it("answers a general HbA1c question from the MongoDB knowledge layer", async () => {
    const provider = new FakeProvider({
      model: "test-model",
      result: {
        decision: "ALLOW",
        category: "DIABETES_EDUCATION",
        answer: "HbA1c shows your average blood sugar over recent months.",
        citedBiomarkers: [],
        citedKnowledgeIds: [hba1cKnowledge.id, "invented-id"],
        usedReportData: false,
        usedKnowledgeBase: true,
      },
    });
    const knowledge = new FakeKnowledgeRepository([hba1cKnowledge]);
    const { service } = await createService(provider, { knowledge });

    const result = await service.ask({
      conversationId,
      userId: "test-user",
      question: "What is the general H1B value?",
    });

    expect(knowledge.receivedQuestion).toBe("What is the general H1B value?");
    expect(provider.received?.knowledge).toEqual([hba1cKnowledge]);
    expect(result.message.knowledgeReferences).toEqual([
      {
        knowledgeId: hba1cKnowledge.id,
        key: hba1cKnowledge.key,
        title: hba1cKnowledge.title,
        sourceName: "CDC",
        sourceUrl: hba1cKnowledge.source.url,
      },
    ]);
  });

  it("uses attached reports internally and keeps only valid citations", async () => {
    const chats = new FakeChatRepository();
    const provider = new FakeProvider({
      model: "test-model",
      responseId: "response-1",
      result: {
        decision: "ALLOW",
        category: "REPORT_VALUES",
        answer: "Your HbA1c value is 6.4%.",
        citedBiomarkers: [
          { reportId, biomarkerId: "hba1c-1" },
          { reportId, biomarkerId: "invented-id" },
        ],
        citedKnowledgeIds: [],
        usedReportData: true,
        usedKnowledgeBase: false,
      },
    });
    const { service } = await createService(provider, { chats });
    await service.attachReport({
      conversationId,
      userId: "test-user",
      reportId,
    });

    const result = await service.ask({
      conversationId,
      userId: "test-user",
      question: "What is my HbA1c?",
    });

    expect(result.attachedReportIds).toEqual([reportId]);
    expect(result.message.citations).toEqual([
      {
        reportId,
        reportName: "report.pdf",
        biomarkerId: "hba1c-1",
        label: "HbA1c",
        value: 6.4,
        unit: "%",
        page: 1,
      },
    ]);
    expect(chats.saved?.promptVersion).toBe("2.0.0");
  });

  it("stops before OpenAI when the per-user limit is reached", async () => {
    const provider = new FakeProvider({
      model: "test-model",
      result: {
        decision: "ALLOW",
        category: "DIABETES_EDUCATION",
        answer: "Answer",
        citedBiomarkers: [],
        citedKnowledgeIds: [],
        usedReportData: false,
        usedKnowledgeBase: false,
      },
    });
    const { service } = await createService(provider, {
      usage: new FakeUsageRepository(false),
    });

    await expect(
      service.ask({
        conversationId,
        userId: "test-user",
        question: "What is diabetes?",
      }),
    ).rejects.toMatchObject({ code: "CHAT_RATE_LIMITED", status: 429 });
    expect(provider.received).toBeUndefined();
  });
});
