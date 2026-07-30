import {
  Schema,
  type Connection,
  type InferSchemaType,
  type Model,
} from "mongoose";
import { canonicalExtractionResultSchema } from "../../contracts/extraction.js";

export const METABOLIC_REPORT_STATUSES = [
  "UPLOADED",
  "QUEUED",
  "PROCESSING",
  "NEEDS_REVIEW",
  "READY",
  "FAILED",
  "REJECTED",
] as const;

const metabolicReportMongoSchema = new Schema(
  {
    subjectId: { type: String, trim: true, index: true },
    displayName: { type: String, required: true, trim: true },
    status: {
      type: String,
      required: true,
      enum: METABOLIC_REPORT_STATUSES,
      index: true,
    },
    file: {
      originalName: { type: String, required: true, trim: true },
      mimeType: {
        type: String,
        required: true,
        enum: ["application/pdf", "image/jpeg", "image/png"],
      },
      byteSize: { type: Number, required: true, min: 1 },
      sha256: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
      storageProvider: {
        type: String,
        required: true,
        enum: ["local", "s3"],
      },
      objectKey: { type: String, required: true, trim: true },
    },
    extraction: {
      type: Schema.Types.Mixed,
      default: null,
      validate: {
        validator: (value: unknown) =>
          value === null ||
          canonicalExtractionResultSchema.safeParse(value).success,
        message: "Extraction does not match the canonical extraction contract.",
      },
    },
    failure: {
      code: { type: String, trim: true },
      message: { type: String, trim: true },
      failedAt: { type: Date },
    },
  },
  {
    collection: "metabolic_reports",
    strict: "throw",
    timestamps: true,
    versionKey: false,
  },
);

metabolicReportMongoSchema.index({ subjectId: 1, createdAt: -1 });
metabolicReportMongoSchema.index({ status: 1, createdAt: 1 });

export type MetabolicReportDocument = InferSchemaType<
  typeof metabolicReportMongoSchema
>;

export function getMetabolicReportModel(
  connection: Connection,
): Model<MetabolicReportDocument> {
  const existingModel = connection.models.MetabolicReport as
    | Model<MetabolicReportDocument>
    | undefined;

  return (
    existingModel ??
    connection.model<MetabolicReportDocument>(
      "MetabolicReport",
      metabolicReportMongoSchema,
    )
  );
}
