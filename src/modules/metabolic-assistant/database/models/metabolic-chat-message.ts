import {
  Schema,
  type Connection,
  type InferSchemaType,
  type Model,
} from "mongoose";
import { CHAT_CATEGORIES } from "../../contracts/chat.js";

const citationSchema = new Schema(
  {
    reportId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "MetabolicReport",
    },
    reportName: { type: String, required: true, trim: true },
    biomarkerId: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    value: { type: Schema.Types.Mixed, required: true },
    unit: { type: String, trim: true },
    page: { type: Number, min: 1 },
  },
  { _id: false, strict: "throw" },
);

const knowledgeReferenceSchema = new Schema(
  {
    knowledgeId: { type: String, required: true, trim: true },
    key: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    sourceName: { type: String, required: true, trim: true },
    sourceUrl: { type: String, required: true, trim: true },
  },
  { _id: false, strict: "throw" },
);

const metabolicChatMessageSchema = new Schema(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
      ref: "MetabolicChatConversation",
    },
    reportId: {
      type: Schema.Types.ObjectId,
      required: false,
      index: true,
      ref: "MetabolicReport",
    },
    userKey: { type: String, required: true, index: true },
    role: { type: String, required: true, enum: ["user", "assistant"] },
    content: { type: String, required: true, trim: true },
    decision: { type: String, enum: ["ALLOW", "REFUSE", "SAFETY"] },
    category: { type: String, enum: CHAT_CATEGORIES },
    citations: { type: [citationSchema], default: [] },
    knowledgeReferences: {
      type: [knowledgeReferenceSchema],
      default: [],
    },
    model: { type: String, trim: true },
    responseId: { type: String, trim: true },
    promptVersion: { type: String, trim: true },
    expiresAt: { type: Date, required: true },
  },
  {
    collection: "metabolic_chat_messages",
    strict: "throw",
    timestamps: true,
    versionKey: false,
  },
);

metabolicChatMessageSchema.index({ conversationId: 1, createdAt: 1 });
metabolicChatMessageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type MetabolicChatMessageDocument = InferSchemaType<
  typeof metabolicChatMessageSchema
>;

export function getMetabolicChatMessageModel(
  connection: Connection,
): Model<MetabolicChatMessageDocument> {
  const existing = connection.models.MetabolicChatMessage as
    | Model<MetabolicChatMessageDocument>
    | undefined;
  return (
    existing ??
    connection.model<MetabolicChatMessageDocument>(
      "MetabolicChatMessage",
      metabolicChatMessageSchema,
    )
  );
}
