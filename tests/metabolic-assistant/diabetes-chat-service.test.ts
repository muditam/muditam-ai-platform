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
  CreateQueuedReportRecord,
  ReportRecord,
  ReportRepositoryPort,
} from "../../src/modules/metabolic-assistant/repositories/report-repository.js";
import { DiabetesChatService } from "../../src/modules/metabolic-assistant/services/diabetes-chat-service.js";

const reportId = "507f1f77bcf86cd799439011";
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

  async createConversation(input: {
    reportId: string;
    reportIds: string[];
    userKey: string;
    expiresAt: Date;
  }): Promise<ChatConversationRecord> {
    return {
      id: "507f1f77bcf86cd799439012",
      reportId: input.reportId,
      reportIds: input.reportIds,
      userKey: input.userKey,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    };
  }
  async getConversation(): Promise<ChatConversationRecord> {
    throw new Error("Not used.");
  }
  async attachReports(): Promise<ChatConversationRecord> {
    throw new Error("Not used.");
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
      reportId: input.reportId,
      userKey: input.userKey,
      role: "assistant",
      content: input.answer,
      decision: input.decision,
      category: input.category,
      citations: input.citations,
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

describe("diabetes chat service", () => {
  it("returns an allowed report answer with only valid report citations", async () => {
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
        usedReportData: true,
      },
    });
    const service = new DiabetesChatService(
      new FakeReportRepository(),
      chats,
      new FakeUsageRepository(),
      provider,
      policy(),
      () => now,
    );

    const result = await service.ask({
      reportId,
      userId: "test-user",
      question: "What is my HbA1c?",
    });

    expect(result.message.decision).toBe("ALLOW");
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
    expect(
      provider.received?.reports[0]?.normalized.biomarkers[0]
        ?.normalizedUnit,
    ).toBe("%");
    expect(chats.saved?.promptVersion).toBe("1.1.0");
  });

  it("uses the configured application rejection message for an off-topic answer", async () => {
    const provider = new FakeProvider({
      model: "test-model",
      result: {
        decision: "ALLOW",
        category: "OFF_TOPIC",
        answer: "This model answer must not reach the user.",
        citedBiomarkers: [{ reportId, biomarkerId: "hba1c-1" }],
        usedReportData: false,
      },
    });
    const service = new DiabetesChatService(
      new FakeReportRepository(),
      new FakeChatRepository(),
      new FakeUsageRepository(),
      provider,
      policy(),
      () => now,
    );

    const result = await service.ask({
      reportId,
      userId: "test-user",
      question: "Who won the match?",
    });

    expect(result.message.decision).toBe("REFUSE");
    expect(result.message.content).toBe(policy().rejectionMessage);
    expect(result.message.citations).toEqual([]);
  });

  it("stops before OpenAI when the per-user limit is reached", async () => {
    const provider = new FakeProvider({
      model: "test-model",
      result: {
        decision: "ALLOW",
        category: "DIABETES_EDUCATION",
        answer: "Answer",
        citedBiomarkers: [],
        usedReportData: false,
      },
    });
    const service = new DiabetesChatService(
      new FakeReportRepository(),
      new FakeChatRepository(),
      new FakeUsageRepository(false),
      provider,
      policy(),
      () => now,
    );

    await expect(
      service.ask({
        reportId,
        userId: "test-user",
        question: "What is diabetes?",
      }),
    ).rejects.toMatchObject({ code: "CHAT_RATE_LIMITED", status: 429 });
    expect(provider.received).toBeUndefined();
  });
});
