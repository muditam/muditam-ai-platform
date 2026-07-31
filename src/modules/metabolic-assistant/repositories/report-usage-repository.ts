import type { Model } from "mongoose";
import type { MetabolicReportUsageDocument } from "../database/models/metabolic-report-usage.js";

export interface ReportUsageRepositoryPort {
  reserve(input: {
    subjectId: string;
    existingReportCount: number;
    maximum: number;
  }): Promise<{ accepted: boolean; remaining: number }>;
  release(subjectId: string): Promise<void>;
}

export class ReportUsageRepository implements ReportUsageRepositoryPort {
  constructor(
    private readonly usageModel: Model<MetabolicReportUsageDocument>,
  ) {}

  async reserve(input: {
    subjectId: string;
    existingReportCount: number;
    maximum: number;
  }): Promise<{ accepted: boolean; remaining: number }> {
    await this.usageModel
      .findOneAndUpdate(
        { subjectId: input.subjectId },
        {
          $max: { count: input.existingReportCount },
          $setOnInsert: { subjectId: input.subjectId },
        },
        { upsert: true, returnDocument: "after" },
      )
      .exec();

    const usage = await this.usageModel
      .findOneAndUpdate(
        {
          subjectId: input.subjectId,
          count: { $lt: input.maximum },
        },
        { $inc: { count: 1 } },
        { returnDocument: "after" },
      )
      .lean()
      .exec();
    if (usage === null) return { accepted: false, remaining: 0 };
    return {
      accepted: true,
      remaining: Math.max(0, input.maximum - Number(usage.count)),
    };
  }

  async release(subjectId: string): Promise<void> {
    await this.usageModel
      .updateOne(
        { subjectId, count: { $gt: 0 } },
        { $inc: { count: -1 } },
      )
      .exec();
  }
}
