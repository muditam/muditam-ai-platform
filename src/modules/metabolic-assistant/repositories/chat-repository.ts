import { Types, type Model } from "mongoose";
import type {
  ChatCategory,
  ChatDecision,
} from "../contracts/chat.js";
import { MetabolicAssistantError } from "../contracts/errors.js";
import type { MetabolicChatConversationDocument } from "../database/models/metabolic-chat-conversation.js";
import type { MetabolicChatMessageDocument } from "../database/models/metabolic-chat-message.js";

export interface ChatCitationRecord {
  reportId: string;
  reportName: string;
  biomarkerId: string;
  label: string;
  value: number | string;
  unit?: string;
  page?: number;
}

export interface ChatConversationRecord {
  id: string;
  reportId: string;
  reportIds: string[];
  userKey: string;
  status: "ACTIVE" | "CLOSED";
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessageRecord {
  id: string;
  conversationId: string;
  reportId: string;
  userKey: string;
  role: "user" | "assistant";
  content: string;
  decision?: ChatDecision;
  category?: ChatCategory;
  citations: ChatCitationRecord[];
  createdAt: Date;
}

export interface SaveChatExchangeInput {
  conversationId: string;
  reportId: string;
  userKey: string;
  question: string;
  answer: string;
  decision: ChatDecision;
  category: ChatCategory;
  citations: ChatCitationRecord[];
  model: string;
  responseId?: string;
  promptVersion: string;
  expiresAt: Date;
}

export interface ChatRepositoryPort {
  createConversation(input: {
    reportId: string;
    reportIds: string[];
    userKey: string;
    expiresAt: Date;
  }): Promise<ChatConversationRecord>;
  getConversation(id: string): Promise<ChatConversationRecord>;
  attachReports(
    conversationId: string,
    reportIds: string[],
    maximum: number,
  ): Promise<ChatConversationRecord>;
  recentMessages(
    conversationId: string,
    limit: number,
  ): Promise<ChatMessageRecord[]>;
  allMessages(conversationId: string): Promise<ChatMessageRecord[]>;
  saveExchange(input: SaveChatExchangeInput): Promise<ChatMessageRecord>;
}

function objectId(id: string, errorCode: "REPORT_NOT_FOUND" | "CHAT_CONVERSATION_NOT_FOUND"): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) {
    throw new MetabolicAssistantError(
      errorCode,
      errorCode === "REPORT_NOT_FOUND"
        ? "Report not found."
        : "Chat conversation not found.",
      { status: 404 },
    );
  }
  return new Types.ObjectId(id);
}

function toConversation(
  value: Record<string, unknown>,
): ChatConversationRecord {
  const primaryReportId = String(value.reportId);
  const storedReportIds = Array.isArray(value.reportIds)
    ? value.reportIds.map(String)
    : [];
  return {
    id: String(value._id),
    reportId: primaryReportId,
    reportIds:
      storedReportIds.length === 0
        ? [primaryReportId]
        : Array.from(new Set([primaryReportId, ...storedReportIds])),
    userKey: String(value.userKey),
    status: value.status as "ACTIVE" | "CLOSED",
    createdAt: value.createdAt as Date,
    updatedAt: value.updatedAt as Date,
  };
}

function toMessage(value: Record<string, unknown>): ChatMessageRecord {
  const result: ChatMessageRecord = {
    id: String(value._id),
    conversationId: String(value.conversationId),
    reportId: String(value.reportId),
    userKey: String(value.userKey),
    role: value.role as "user" | "assistant",
    content: String(value.content),
    citations: (value.citations ?? []) as ChatCitationRecord[],
    createdAt: value.createdAt as Date,
  };
  if (value.decision !== undefined) {
    result.decision = value.decision as ChatDecision;
  }
  if (value.category !== undefined) {
    result.category = value.category as ChatCategory;
  }
  return result;
}

export class ChatRepository implements ChatRepositoryPort {
  constructor(
    private readonly conversationModel: Model<MetabolicChatConversationDocument>,
    private readonly messageModel: Model<MetabolicChatMessageDocument>,
  ) {}

  async createConversation(input: {
    reportId: string;
    reportIds: string[];
    userKey: string;
    expiresAt: Date;
  }): Promise<ChatConversationRecord> {
    const primaryReportId = objectId(input.reportId, "REPORT_NOT_FOUND");
    const created = await this.conversationModel.create({
      reportId: primaryReportId,
      reportIds: Array.from(
        new Set([input.reportId, ...input.reportIds]),
      ).map((id) => objectId(id, "REPORT_NOT_FOUND")),
      userKey: input.userKey,
      status: "ACTIVE",
      expiresAt: input.expiresAt,
    });
    return toConversation(
      created.toObject() as unknown as Record<string, unknown>,
    );
  }

  async attachReports(
    conversationId: string,
    reportIds: string[],
    maximum: number,
  ): Promise<ChatConversationRecord> {
    const conversationObjectId = objectId(
      conversationId,
      "CHAT_CONVERSATION_NOT_FOUND",
    );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.conversationModel
        .findById(conversationObjectId)
        .lean()
        .exec();
      if (current === null) {
        throw new MetabolicAssistantError(
          "CHAT_CONVERSATION_NOT_FOUND",
          "Chat conversation not found.",
          { status: 404 },
        );
      }
      const raw = current as unknown as Record<string, unknown>;
      const currentRecord = toConversation(raw);
      const combined = Array.from(
        new Set([...currentRecord.reportIds, ...reportIds]),
      );
      if (combined.length > maximum) {
        throw new MetabolicAssistantError(
          "CHAT_REPORT_LIMIT_EXCEEDED",
          "This conversation has reached its report limit.",
          { status: 400, details: { maximum } },
        );
      }
      if (combined.length === currentRecord.reportIds.length) {
        return currentRecord;
      }

      const rawReportIds = Array.isArray(raw.reportIds)
        ? raw.reportIds
        : [];
      const versionFilter =
        rawReportIds.length === 0
          ? {
              $or: [
                { reportIds: { $exists: false } },
                { reportIds: { $size: 0 } },
              ],
            }
          : { reportIds: rawReportIds };
      const updated = await this.conversationModel
        .findOneAndUpdate(
          { _id: conversationObjectId, ...versionFilter },
          {
            $set: {
              reportIds: combined.map((id) =>
                objectId(id, "REPORT_NOT_FOUND"),
              ),
            },
          },
          { returnDocument: "after" },
        )
        .lean()
        .exec();
      if (updated !== null) {
        return toConversation(
          updated as unknown as Record<string, unknown>,
        );
      }
    }
    throw new MetabolicAssistantError(
      "INTERNAL_ERROR",
      "The conversation report list changed during this request. Please retry.",
      { status: 409 },
    );
  }

  async getConversation(id: string): Promise<ChatConversationRecord> {
    const conversation = await this.conversationModel
      .findById(objectId(id, "CHAT_CONVERSATION_NOT_FOUND"))
      .lean()
      .exec();
    if (conversation === null) {
      throw new MetabolicAssistantError(
        "CHAT_CONVERSATION_NOT_FOUND",
        "Chat conversation not found.",
        { status: 404 },
      );
    }
    return toConversation(
      conversation as unknown as Record<string, unknown>,
    );
  }

  async recentMessages(
    conversationId: string,
    limit: number,
  ): Promise<ChatMessageRecord[]> {
    const messages = await this.messageModel
      .find({
        conversationId: objectId(
          conversationId,
          "CHAT_CONVERSATION_NOT_FOUND",
        ),
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();
    return messages
      .reverse()
      .map((message) =>
        toMessage(message as unknown as Record<string, unknown>),
      );
  }

  async allMessages(conversationId: string): Promise<ChatMessageRecord[]> {
    const messages = await this.messageModel
      .find({
        conversationId: objectId(
          conversationId,
          "CHAT_CONVERSATION_NOT_FOUND",
        ),
      })
      .sort({ createdAt: 1 })
      .limit(200)
      .lean()
      .exec();
    return messages.map((message) =>
      toMessage(message as unknown as Record<string, unknown>),
    );
  }

  async saveExchange(input: SaveChatExchangeInput): Promise<ChatMessageRecord> {
    const conversationId = objectId(
      input.conversationId,
      "CHAT_CONVERSATION_NOT_FOUND",
    );
    const reportId = objectId(input.reportId, "REPORT_NOT_FOUND");
    const common = {
      conversationId,
      reportId,
      userKey: input.userKey,
      expiresAt: input.expiresAt,
    };
    const payloads: Record<string, unknown>[] = [
      {
        ...common,
        role: "user",
        content: input.question,
        citations: [],
      },
      {
        ...common,
        role: "assistant",
        content: input.answer,
        decision: input.decision,
        category: input.category,
        citations: input.citations,
        model: input.model,
        promptVersion: input.promptVersion,
      },
    ];
    if (input.responseId !== undefined) {
      payloads[1]!.responseId = input.responseId;
    }
    const created = await this.messageModel.insertMany(payloads);
    const assistant = created[1];
    if (assistant === undefined) {
      throw new MetabolicAssistantError(
        "INTERNAL_ERROR",
        "The chat response could not be saved.",
      );
    }
    return toMessage(
      (
        assistant as unknown as {
          toObject(): Record<string, unknown>;
        }
      ).toObject(),
    );
  }
}
