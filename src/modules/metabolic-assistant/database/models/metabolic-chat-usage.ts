import {
  Schema,
  type Connection,
  type InferSchemaType,
  type Model,
} from "mongoose";

const metabolicChatUsageSchema = new Schema(
  {
    userKey: { type: String, required: true },
    windowStart: { type: Date, required: true },
    count: { type: Number, required: true, min: 0, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  {
    collection: "metabolic_chat_usage",
    strict: "throw",
    timestamps: true,
    versionKey: false,
  },
);

metabolicChatUsageSchema.index(
  { userKey: 1, windowStart: 1 },
  { unique: true },
);
metabolicChatUsageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type MetabolicChatUsageDocument = InferSchemaType<
  typeof metabolicChatUsageSchema
>;

export function getMetabolicChatUsageModel(
  connection: Connection,
): Model<MetabolicChatUsageDocument> {
  const existing = connection.models.MetabolicChatUsage as
    | Model<MetabolicChatUsageDocument>
    | undefined;
  return (
    existing ??
    connection.model<MetabolicChatUsageDocument>(
      "MetabolicChatUsage",
      metabolicChatUsageSchema,
    )
  );
}
