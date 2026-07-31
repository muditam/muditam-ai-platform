import {
  Schema,
  type Connection,
  type InferSchemaType,
  type Model,
} from "mongoose";

const metabolicReportUsageSchema = new Schema(
  {
    subjectId: { type: String, required: true, trim: true, unique: true },
    count: { type: Number, required: true, min: 0, default: 0 },
  },
  {
    collection: "metabolic_report_usage",
    strict: "throw",
    timestamps: true,
    versionKey: false,
  },
);

export type MetabolicReportUsageDocument = InferSchemaType<
  typeof metabolicReportUsageSchema
>;

export function getMetabolicReportUsageModel(
  connection: Connection,
): Model<MetabolicReportUsageDocument> {
  const existing = connection.models.MetabolicReportUsage as
    | Model<MetabolicReportUsageDocument>
    | undefined;
  return (
    existing ??
    connection.model<MetabolicReportUsageDocument>(
      "MetabolicReportUsage",
      metabolicReportUsageSchema,
    )
  );
}
