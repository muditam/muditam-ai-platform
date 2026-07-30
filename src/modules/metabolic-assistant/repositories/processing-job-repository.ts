import { Types, type Model } from "mongoose";
import type { MetabolicProcessingJobDocument } from "../database/models/metabolic-processing-job.js";

export interface ExtractionJobLease {
  id: string;
  reportId: string;
  attempts: number;
}

export interface ProcessingJobRepositoryPort {
  leaseNext(now: Date, leaseMs: number): Promise<ExtractionJobLease | null>;
  complete(jobId: string): Promise<void>;
  fail(
    jobId: string,
    attempts: number,
    maxAttempts: number,
    errorCode: string,
    retryAt: Date,
  ): Promise<{ terminal: boolean }>;
}

export class ProcessingJobRepository
  implements ProcessingJobRepositoryPort
{
  constructor(
    private readonly jobModel: Model<MetabolicProcessingJobDocument>,
  ) {}

  async leaseNext(
    now: Date,
    leaseMs: number,
  ): Promise<ExtractionJobLease | null> {
    const job = await this.jobModel
      .findOneAndUpdate(
        {
          type: "extract_report",
          $or: [
            { status: "queued", availableAt: { $lte: now } },
            { status: "leased", leaseExpiresAt: { $lte: now } },
          ],
        },
        {
          $set: {
            status: "leased",
            leaseExpiresAt: new Date(now.getTime() + leaseMs),
          },
          $inc: { attempts: 1 },
        },
        {
          sort: { availableAt: 1, createdAt: 1 },
          new: true,
        },
      )
      .lean()
      .exec();
    if (job === null) return null;
    return {
      id: String(job._id),
      reportId: String(job.reportId),
      attempts: job.attempts,
    };
  }

  async complete(jobId: string): Promise<void> {
    await this.jobModel
      .updateOne(
        { _id: new Types.ObjectId(jobId), status: "leased" },
        {
          $set: { status: "completed" },
          $unset: { leaseExpiresAt: 1, lastErrorCode: 1 },
        },
      )
      .exec();
  }

  async fail(
    jobId: string,
    attempts: number,
    maxAttempts: number,
    errorCode: string,
    retryAt: Date,
  ): Promise<{ terminal: boolean }> {
    const terminal = attempts >= maxAttempts;
    await this.jobModel
      .updateOne(
        { _id: new Types.ObjectId(jobId), status: "leased" },
        terminal
          ? {
              $set: {
                status: "dead_letter",
                lastErrorCode: errorCode,
              },
              $unset: { leaseExpiresAt: 1 },
            }
          : {
              $set: {
                status: "queued",
                availableAt: retryAt,
                lastErrorCode: errorCode,
              },
              $unset: { leaseExpiresAt: 1 },
            },
      )
      .exec();
    return { terminal };
  }
}
