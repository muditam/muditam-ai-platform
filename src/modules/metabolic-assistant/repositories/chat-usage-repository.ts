import type { Model } from "mongoose";
import type { MetabolicChatUsageDocument } from "../database/models/metabolic-chat-usage.js";

export interface ChatUsageReservation {
  accepted: boolean;
  remaining: number;
  windowStart: Date;
  resetsAt: Date;
}

export interface ChatUsageRepositoryPort {
  reserve(input: {
    userKey: string;
    now: Date;
    windowMinutes: number;
    maximum: number;
  }): Promise<ChatUsageReservation>;
  release(input: {
    userKey: string;
    windowStart: Date;
  }): Promise<void>;
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

export class ChatUsageRepository implements ChatUsageRepositoryPort {
  constructor(
    private readonly usageModel: Model<MetabolicChatUsageDocument>,
  ) {}

  async reserve(input: {
    userKey: string;
    now: Date;
    windowMinutes: number;
    maximum: number;
  }): Promise<ChatUsageReservation> {
    const windowMs = input.windowMinutes * 60_000;
    const windowStart = new Date(
      Math.floor(input.now.getTime() / windowMs) * windowMs,
    );
    const resetsAt = new Date(windowStart.getTime() + windowMs);
    try {
      const usage = await this.usageModel
        .findOneAndUpdate(
          {
            userKey: input.userKey,
            windowStart,
            count: { $lt: input.maximum },
          },
          {
            $inc: { count: 1 },
            $setOnInsert: {
              userKey: input.userKey,
              windowStart,
              expiresAt: resetsAt,
            },
          },
          { upsert: true, returnDocument: "after" },
        )
        .lean()
        .exec();
      if (usage === null) {
        return {
          accepted: false,
          remaining: 0,
          windowStart,
          resetsAt,
        };
      }
      return {
        accepted: true,
        remaining: Math.max(0, input.maximum - Number(usage.count)),
        windowStart,
        resetsAt,
      };
    } catch (error) {
      if (isDuplicateKey(error)) {
        const usage = await this.usageModel
          .findOneAndUpdate(
            {
              userKey: input.userKey,
              windowStart,
              count: { $lt: input.maximum },
            },
            { $inc: { count: 1 } },
            { returnDocument: "after" },
          )
          .lean()
          .exec();
        if (usage !== null) {
          return {
            accepted: true,
            remaining: Math.max(0, input.maximum - Number(usage.count)),
            windowStart,
            resetsAt,
          };
        }
        return {
          accepted: false,
          remaining: 0,
          windowStart,
          resetsAt,
        };
      }
      throw error;
    }
  }

  async release(input: {
    userKey: string;
    windowStart: Date;
  }): Promise<void> {
    await this.usageModel
      .updateOne(
        {
          userKey: input.userKey,
          windowStart: input.windowStart,
          count: { $gt: 0 },
        },
        { $inc: { count: -1 } },
      )
      .exec();
  }
}
