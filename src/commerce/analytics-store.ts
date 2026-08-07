import { MongoClient, type Document, type UpdateFilter } from "mongodb";
import { disclosedCondition } from "./guardrails.js";
import type { CommerceChatRequest, CommerceChatResponse } from "./contracts.js";

function mongoUri(): string | undefined {
  return process.env.MUDITAM_MONGO_URI ?? process.env.MONGO_URI;
}

let client: MongoClient | null = null;

async function database() {
  const uri = mongoUri();
  if (!uri) return null;
  client ??= new MongoClient(uri, { maxPoolSize: 5, minPoolSize: 0, serverSelectionTimeoutMS: 5_000 });
  await client.connect();
  return client.db(process.env.MUDITAM_KNOWLEDGE_DB || undefined);
}

function todayDateString(now: Date): string {
  return now.toISOString().slice(0, 10);
}

async function touchVisitor(
  visitorId: string,
  language: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const db = await database();
  if (!db) return;
  const now = new Date();
  await db.collection("commerce_visitors").updateOne(
    { visitorId },
    {
      $setOnInsert: { visitorId, firstSeenAt: now },
      $set: { lastSeenAt: now, language, ...extra },
      $addToSet: { visitedDays: todayDateString(now) },
      $inc: { eventsCounter: 1 },
    },
    { upsert: true },
  );
}

const ESCALATING_DECISIONS = new Set(["HANDOFF", "SAFETY"]);

export async function recordMessageTurn(
  input: CommerceChatRequest,
  result: CommerceChatResponse,
): Promise<void> {
  try {
    const db = await database();
    if (!db) return;
    const now = new Date();
    const conversationId = input.conversationId;

    await db.collection("commerce_conversations").updateOne(
      { conversationId },
      {
        $setOnInsert: {
          conversationId,
          visitorId: input.visitorId,
          channel: input.channel,
          startedAt: now,
          feedback: null,
          leadCaptured: false,
          resolutionStatus: "resolved",
        },
        $set: {
          language: input.language,
          pageContext: input.pageContext ?? null,
          lastMessageAt: now,
          ...(ESCALATING_DECISIONS.has(result.decision) ? { resolutionStatus: "escalated" } : {}),
        },
        $addToSet: { intents: result.category },
      },
      { upsert: true },
    );

    const assistantText = result.messages.map((message) => message.text).join("\n\n");
    await db.collection("commerce_messages").insertMany([
      {
        conversationId,
        role: "user",
        text: input.message,
        createdAt: now,
      },
      {
        conversationId,
        role: "assistant",
        text: assistantText,
        category: result.category,
        decision: result.decision,
        recommendedProducts: result.recommendedProducts.map((product) => product.productSlug),
        createdAt: now,
      },
    ]);

    const healthConcern = disclosedCondition(input.message);
    await touchVisitor(
      input.visitorId,
      input.language,
      healthConcern ? { healthConcern } : {},
    );
  } catch (error) {
    console.warn(JSON.stringify({
      service: "muditam-ai-platform",
      event: "commerce_analytics.record_message_failed",
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

export interface CommerceWidgetEvent {
  conversationId?: string;
  visitorId: string;
  type: string;
  productSlug?: string;
  url?: string;
}

const LEAD_EVENT_TYPES = new Set(["expert_call_clicked", "expert_whatsapp_clicked"]);

export async function recordWidgetEvent(input: CommerceWidgetEvent): Promise<void> {
  try {
    const db = await database();
    if (!db) return;
    const now = new Date();
    await db.collection("commerce_events").insertOne({
      conversationId: input.conversationId ?? null,
      visitorId: input.visitorId,
      type: input.type,
      productSlug: input.productSlug ?? null,
      url: input.url ?? null,
      createdAt: now,
    });

    if (input.type === "pageview" && input.url) {
      const journeyUpdate = {
        $setOnInsert: { visitorId: input.visitorId, firstSeenAt: now },
        $set: { lastSeenAt: now },
        $addToSet: { visitedDays: todayDateString(now) },
        $push: { journey: { url: input.url, visitedAt: now } },
      };
      await db.collection("commerce_visitors").updateOne(
        { visitorId: input.visitorId },
        journeyUpdate as unknown as UpdateFilter<Document>,
        { upsert: true },
      );
    }

    if (LEAD_EVENT_TYPES.has(input.type) && input.conversationId) {
      await db.collection("commerce_conversations").updateOne(
        { conversationId: input.conversationId },
        { $set: { leadCaptured: true } },
      );
    }
  } catch (error) {
    console.warn(JSON.stringify({
      service: "muditam-ai-platform",
      event: "commerce_analytics.record_event_failed",
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

export async function recordFeedback(conversationId: string, rating: "up" | "down"): Promise<void> {
  try {
    const db = await database();
    if (!db) return;
    await db.collection("commerce_conversations").updateOne(
      { conversationId },
      { $set: { feedback: rating } },
    );
  } catch (error) {
    console.warn(JSON.stringify({
      service: "muditam-ai-platform",
      event: "commerce_analytics.record_feedback_failed",
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}
