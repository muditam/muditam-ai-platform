import {
  Schema,
  type Connection,
  type InferSchemaType,
  type Model,
} from "mongoose";
import { knowledgeCategorySchema } from "../../contracts/knowledge.js";

const metabolicKnowledgeEntrySchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    title: { type: String, required: true, trim: true },
    category: {
      type: String,
      required: true,
      enum: knowledgeCategorySchema.options,
      index: true,
    },
    content: { type: String, required: true, trim: true },
    keywords: {
      type: [{ type: String, required: true, trim: true, lowercase: true }],
      default: [],
    },
    source: {
      name: { type: String, required: true, trim: true },
      url: { type: String, required: true, trim: true },
      reviewedAt: { type: String, required: true, trim: true },
    },
    version: { type: String, required: true, trim: true },
    active: { type: Boolean, required: true, default: true, index: true },
    seededAt: { type: Date, required: true },
  },
  {
    collection: "metabolic_knowledge_entries",
    strict: "throw",
    timestamps: true,
    versionKey: false,
  },
);

metabolicKnowledgeEntrySchema.index(
  { title: "text", content: "text", keywords: "text" },
  { name: "metabolic_knowledge_text" },
);
metabolicKnowledgeEntrySchema.index({ active: 1, category: 1 });

export type MetabolicKnowledgeEntryDocument = InferSchemaType<
  typeof metabolicKnowledgeEntrySchema
>;

export function getMetabolicKnowledgeEntryModel(
  connection: Connection,
): Model<MetabolicKnowledgeEntryDocument> {
  const existing = connection.models.MetabolicKnowledgeEntry as
    | Model<MetabolicKnowledgeEntryDocument>
    | undefined;
  return (
    existing ??
    connection.model<MetabolicKnowledgeEntryDocument>(
      "MetabolicKnowledgeEntry",
      metabolicKnowledgeEntrySchema,
    )
  );
}
