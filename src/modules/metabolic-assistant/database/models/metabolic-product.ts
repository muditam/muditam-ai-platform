import {
  Schema,
  type Connection,
  type InferSchemaType,
  type Model,
} from "mongoose";
import { productCategorySchema } from "../../constants/products.js";

const metabolicProductMongoSchema = new Schema(
  {
    sku: { type: String, required: true, unique: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    category: {
      type: String,
      required: true,
      enum: productCategorySchema.options,
      index: true,
    },
    indication: { type: String, required: true, trim: true },
    composition: { type: String, required: true, trim: true },
    applicableBiomarkers: {
      type: [{ type: String, required: true, trim: true }],
      default: [],
    },
    keyIngredients: {
      type: [{ type: String, required: true, trim: true }],
      default: [],
    },
    recommendedDosage: { type: String, required: true, trim: true },
    productUrl: { type: String, default: null, trim: true },
    contraindications: {
      type: [{ type: String, required: true, trim: true }],
      default: [],
    },
    safetyNotes: {
      type: [{ type: String, required: true, trim: true }],
      default: [],
    },
    recommendationStatus: {
      type: String,
      required: true,
      enum: ["test_only"],
      default: "test_only",
      index: true,
    },
    catalogVersion: { type: String, required: true, trim: true },
    active: { type: Boolean, required: true, default: true, index: true },
    seededAt: { type: Date, required: true },
  },
  {
    collection: "metabolic_products",
    strict: "throw",
    timestamps: true,
    versionKey: false,
  },
);

metabolicProductMongoSchema.index({ category: 1, active: 1 });
metabolicProductMongoSchema.index({ applicableBiomarkers: 1, active: 1 });

export type MetabolicProductDocument = InferSchemaType<
  typeof metabolicProductMongoSchema
>;

export function getMetabolicProductModel(
  connection: Connection,
): Model<MetabolicProductDocument> {
  const existingModel = connection.models.MetabolicProduct as
    | Model<MetabolicProductDocument>
    | undefined;

  return (
    existingModel ??
    connection.model<MetabolicProductDocument>(
      "MetabolicProduct",
      metabolicProductMongoSchema,
    )
  );
}
