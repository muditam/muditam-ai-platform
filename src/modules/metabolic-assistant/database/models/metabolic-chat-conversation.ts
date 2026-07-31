import {
  Schema,
  type Connection,
  type InferSchemaType,
  type Model,
} from "mongoose";

const metabolicChatConversationSchema = new Schema(
  {
    reportId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
      ref: "MetabolicReport",
    },
    reportIds: {
      type: [Schema.Types.ObjectId],
      required: true,
      default: [],
      ref: "MetabolicReport",
    },
    userKey: { type: String, required: true, index: true },
    status: {
      type: String,
      required: true,
      enum: ["ACTIVE", "CLOSED"],
      default: "ACTIVE",
    },
    expiresAt: { type: Date, required: true },
  },
  {
    collection: "metabolic_chat_conversations",
    strict: "throw",
    timestamps: true,
    versionKey: false,
  },
);

metabolicChatConversationSchema.index({ userKey: 1, reportId: 1, createdAt: -1 });
metabolicChatConversationSchema.index({ reportIds: 1 });
metabolicChatConversationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type MetabolicChatConversationDocument = InferSchemaType<
  typeof metabolicChatConversationSchema
>;

export function getMetabolicChatConversationModel(
  connection: Connection,
): Model<MetabolicChatConversationDocument> {
  const existing = connection.models.MetabolicChatConversation as
    | Model<MetabolicChatConversationDocument>
    | undefined;
  return (
    existing ??
    connection.model<MetabolicChatConversationDocument>(
      "MetabolicChatConversation",
      metabolicChatConversationSchema,
    )
  );
}
