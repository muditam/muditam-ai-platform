import {
  Schema,
  type Connection,
  type InferSchemaType,
  type Model,
} from "mongoose";

export const METABOLIC_JOB_STATUSES = [
  "queued",
  "leased",
  "completed",
  "failed",
  "dead_letter",
] as const;

const metabolicProcessingJobMongoSchema = new Schema(
  {
    reportId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
      ref: "MetabolicReport",
    },
    type: {
      type: String,
      required: true,
      enum: ["extract_report"],
      default: "extract_report",
    },
    status: {
      type: String,
      required: true,
      enum: METABOLIC_JOB_STATUSES,
      default: "queued",
      index: true,
    },
    attempts: { type: Number, required: true, min: 0, default: 0 },
    availableAt: { type: Date, required: true, default: Date.now, index: true },
    leaseExpiresAt: { type: Date, default: null },
    lastErrorCode: { type: String, trim: true },
  },
  {
    collection: "metabolic_processing_jobs",
    strict: "throw",
    timestamps: true,
    versionKey: false,
  },
);

metabolicProcessingJobMongoSchema.index(
  { reportId: 1, type: 1 },
  { unique: true },
);
metabolicProcessingJobMongoSchema.index({
  status: 1,
  availableAt: 1,
  leaseExpiresAt: 1,
});

export type MetabolicProcessingJobDocument = InferSchemaType<
  typeof metabolicProcessingJobMongoSchema
>;

export function getMetabolicProcessingJobModel(
  connection: Connection,
): Model<MetabolicProcessingJobDocument> {
  const existingModel = connection.models.MetabolicProcessingJob as
    | Model<MetabolicProcessingJobDocument>
    | undefined;

  return (
    existingModel ??
    connection.model<MetabolicProcessingJobDocument>(
      "MetabolicProcessingJob",
      metabolicProcessingJobMongoSchema,
    )
  );
}
