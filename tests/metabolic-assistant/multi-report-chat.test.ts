import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  ChatProviderInput,
  ChatProviderResponse,
  ReportChatProvider,
} from "../../src/modules/metabolic-assistant/adapters/chat/chat-provider.js";
import { buildMetabolicChatPolicy } from "../../src/modules/metabolic-assistant/config/chat-policy.js";
import { loadMetabolicEnvironment } from "../../src/modules/metabolic-assistant/config/env.js";
import type { CanonicalExtractionResult } from "../../src/modules/metabolic-assistant/contracts/extraction.js";
import { MetabolicAssistantError } from "../../src/modules/metabolic-assistant/contracts/errors.js";
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
import type { KnowledgeRepositoryPort } from "../../src/modules/metabolic-assistant/repositories/knowledge-repository.js";
import type {
  CreateQueuedReportRecord,
  ReportRecord,
  ReportRepositoryPort,
} from "../../src/modules/metabolic-assistant/repositories/report-repository.js";
import { DiabetesChatService } from "../../src/modules/metabolic-assistant/services/diabetes-chat-service.js";

const firstId = "507f1f77bcf86cd799439021";
const secondId = "507f1f77bcf86cd799439022";
const conversationId = "507f1f77bcf86cd799439023";
const now = new Date("2026-07-31T00:00:00.000Z");

function extraction(reportId: string, value: number): CanonicalExtractionResult {
  return {
    schemaVersion: "1.0.0",
    reportId,
    provider: { kind: "test", name: "fixture", version: "1" },
    source: {
      fileName: `${reportId}.pdf`,
      mimeType: "application/pdf",
      sha256: "a".repeat(64),
    },
    biomarkers: [
      {
        id: "hba1c-1",
        canonicalCode: "hba1c",
        panel: "GLYCEMIC",
        sourceLabel: "HbA1c",
        numericValue: value,
        unit: "%",
        status: "UNKNOWN",
        confidence: 0.99,
        sourcePage: 1,
        reviewState: "UNREVIEWED",
      },
    ],
    warnings: [],
    extractedAt: now.toISOString(),
  };
}

function record(id: string, name: string, value: number, day: number): ReportRecord {
  return {
    id,
    subjectId: "test-user",
    displayName: name,
    status: "NEEDS_REVIEW",
    file: {
      originalName: name,
      mimeType: "application/pdf",
      byteSize: 100,
      sha256: "a".repeat(64),
      storageProvider: "local",
      objectKey: name,
    },
    extraction: extraction(id, value),
    createdAt: new Date(`2026-07-${String(day).padStart(2, "0")}T00:00:00.000Z`),
    updatedAt: now,
  };
}

class Reports implements ReportRepositoryPort {
  readonly values = new Map([
    [firstId, record(firstId, "January.pdf", 7.2, 1)],
    [secondId, record(secondId, "July.pdf", 6.4, 2)],
  ]);
  createId(): string {
    return firstId;
  }
  async createQueued(_input: CreateQueuedReportRecord): Promise<ReportRecord> {
    throw new Error("Not used.");
  }
  async getById(id: string): Promise<ReportRecord> {
    const value = this.values.get(id);
    if (value === undefined) throw new Error("Missing fixture.");
    return value;
  }
  async countBySubjectId(): Promise<number> {
    return this.values.size;
  }
  async list(): Promise<ReportRecord[]> {
    return [...this.values.values()];
  }
  async deleteById(): Promise<ReportRecord> {
    throw new Error("Not used.");
  }
}

class Chats implements ChatRepositoryPort {
  conversation: ChatConversationRecord = {
    id: conversationId,
    reportIds: [],
    userKey: createHash("sha256").update("test-user").digest("hex"),
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  };
  async createConversation(): Promise<ChatConversationRecord> {
    return this.conversation;
  }
  async getConversation(): Promise<ChatConversationRecord> {
    return this.conversation;
  }
  async listConversations(): Promise<ChatConversationRecord[]> {
    return [this.conversation];
  }
  async attachReports(
    _id: string,
    reportIds: string[],
    maximum: number,
  ): Promise<ChatConversationRecord> {
    const combined = [...new Set([...this.conversation.reportIds, ...reportIds])];
    if (combined.length > maximum) {
      throw new MetabolicAssistantError(
        "CHAT_REPORT_LIMIT_EXCEEDED",
        "This conversation has reached its report limit.",
        { status: 400 },
      );
    }
    this.conversation = { ...this.conversation, reportIds: combined };
    return this.conversation;
  }
  async detachReport(_id: string, reportId: string): Promise<void> {
    this.conversation = {
      ...this.conversation,
      reportIds: this.conversation.reportIds.filter((id) => id !== reportId),
    };
  }
  async detachReportEverywhere(reportId: string): Promise<void> {
    await this.detachReport(conversationId, reportId);
  }
  async recentMessages(): Promise<ChatMessageRecord[]> {
    return [];
  }
  async allMessages(): Promise<ChatMessageRecord[]> {
    return [];
  }
  async saveExchange(input: SaveChatExchangeInput): Promise<ChatMessageRecord> {
    return {
      id: "507f1f77bcf86cd799439024",
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

class Usage implements ChatUsageRepositoryPort {
  async reserve(): Promise<ChatUsageReservation> {
    return {
      accepted: true,
      remaining: 19,
      windowStart: now,
      resetsAt: new Date("2026-08-01T00:00:00.000Z"),
    };
  }
  async release(): Promise<void> {}
}

class Knowledge implements KnowledgeRepositoryPort {
  async search() {
    return [];
  }
}

class Provider implements ReportChatProvider {
  received?: ChatProviderInput;
  async answer(input: ChatProviderInput): Promise<ChatProviderResponse> {
    this.received = input;
    return {
      model: "test-model",
      result: {
        decision: "ALLOW",
        category: "REPORT_COMPARISON",
        answer: "HbA1c decreased from 7.2% to 6.4%.",
        citedBiomarkers: [
          { reportId: firstId, biomarkerId: "hba1c-1" },
          { reportId: secondId, biomarkerId: "hba1c-1" },
        ],
        citedKnowledgeIds: [],
        usedReportData: true,
        usedKnowledgeBase: false,
      },
    };
  }
}

function policy(maximum = 3) {
  return buildMetabolicChatPolicy(
    loadMetabolicEnvironment({
      NODE_ENV: "test",
      METABOLIC_CHAT_ENABLED: "true",
      METABOLIC_CHAT_MAX_REPORTS_PER_CONVERSATION: String(maximum),
    }),
  );
}

describe("multi-report diabetes chat", () => {
  it("compares all reports attached to a conversation without report IDs in ask", async () => {
    const provider = new Provider();
    const chats = new Chats();
    const service = new DiabetesChatService(
      new Reports(),
      chats,
      new Usage(),
      new Knowledge(),
      provider,
      policy(),
      () => now,
    );
    await service.attachReport({ conversationId, userId: "test-user", reportId: firstId });
    await service.attachReport({ conversationId, userId: "test-user", reportId: secondId });

    const result = await service.ask({
      conversationId,
      userId: "test-user",
      question: "How did my HbA1c change?",
    });

    expect(result.attachedReportIds).toEqual([firstId, secondId]);
    expect(result.message.category).toBe("REPORT_COMPARISON");
    expect(result.message.citations).toHaveLength(2);
    expect(provider.received?.comparison.biomarkers[0]?.latestChange.direction).toBe(
      "DECREASED",
    );
    expect(provider.received?.comparison.biomarkers[0]?.latestChange.absolute).toBeCloseTo(
      -0.8,
    );
  });

  it("enforces the configurable per-conversation report limit while attaching", async () => {
    const provider = new Provider();
    const service = new DiabetesChatService(
      new Reports(),
      new Chats(),
      new Usage(),
      new Knowledge(),
      provider,
      policy(1),
      () => now,
    );
    await service.attachReport({ conversationId, userId: "test-user", reportId: firstId });

    await expect(
      service.attachReport({
        conversationId,
        userId: "test-user",
        reportId: secondId,
      }),
    ).rejects.toMatchObject({
      code: "CHAT_REPORT_LIMIT_EXCEEDED",
      status: 400,
    });
    expect(provider.received).toBeUndefined();
  });
});
