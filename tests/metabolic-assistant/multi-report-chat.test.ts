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

const firstId = "507f1f77bcf86cd799439021";
const secondId = "507f1f77bcf86cd799439022";
const now = new Date("2026-07-31T00:00:00.000Z");

function extraction(
  reportId: string,
  value: number,
): CanonicalExtractionResult {
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
  async createConversation(input: {
    reportId: string;
    reportIds: string[];
    userKey: string;
    expiresAt: Date;
  }): Promise<ChatConversationRecord> {
    return {
      id: "507f1f77bcf86cd799439023",
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
    return {
      id: "507f1f77bcf86cd799439024",
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
        usedReportData: true,
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
  it("gives OpenAI trusted comparison facts and returns report-aware citations", async () => {
    const provider = new Provider();
    const service = new DiabetesChatService(
      new Reports(),
      new Chats(),
      new Usage(),
      provider,
      policy(),
      () => now,
    );

    const result = await service.ask({
      reportId: firstId,
      reportIds: [secondId],
      userId: "test-user",
      question: "How did my HbA1c change?",
    });

    expect(result.reportIds).toEqual([firstId, secondId]);
    expect(result.message.category).toBe("REPORT_COMPARISON");
    expect(result.message.citations).toHaveLength(2);
    expect(
      provider.received?.comparison.biomarkers[0]?.latestChange.direction,
    ).toBe("DECREASED");
    expect(
      provider.received?.comparison.biomarkers[0]?.latestChange.absolute,
    ).toBeCloseTo(-0.8);
  });

  it("rejects too many selected reports before calling OpenAI", async () => {
    const provider = new Provider();
    const service = new DiabetesChatService(
      new Reports(),
      new Chats(),
      new Usage(),
      provider,
      policy(2),
      () => now,
    );

    await expect(
      service.ask({
        reportId: firstId,
        reportIds: [secondId, "507f1f77bcf86cd799439025"],
        userId: "test-user",
        question: "Compare all reports.",
      }),
    ).rejects.toMatchObject({
      code: "CHAT_REPORT_LIMIT_EXCEEDED",
      status: 400,
    });
    expect(provider.received).toBeUndefined();
  });
});
