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

interface VisitorLocation {
  city: string | null;
  region: string | null;
  country: string | null;
}

// Free, no-signup IP geolocation. Deliberately not ip-api.com: its free tier's
// terms restrict it to non-commercial use, which a storefront chat doesn't qualify for.
async function lookupLocation(ip: string): Promise<VisitorLocation | null> {
  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return null;
    const data = await response.json() as { success?: boolean; city?: string; region?: string; country?: string };
    if (!data.success) return null;
    return { city: data.city ?? null, region: data.region ?? null, country: data.country ?? null };
  } catch {
    return null;
  }
}

async function touchVisitor(
  visitorId: string,
  language: string,
  options: { ip?: string; healthConcern?: string } = {},
): Promise<void> {
  const db = await database();
  if (!db) return;
  const now = new Date();
  const existing = await db.collection("commerce_visitors")
    .findOne({ visitorId }, { projection: { location: 1, healthConcerns: 1 } });

  const location = !existing?.location && options.ip ? await lookupLocation(options.ip) : undefined;
  const existingConcerns: Array<{ concern: string }> = existing?.healthConcerns ?? [];
  const newConcern = options.healthConcern && !existingConcerns.some((item) => item.concern === options.healthConcern)
    ? options.healthConcern
    : null;

  const update = {
    $setOnInsert: { visitorId, firstSeenAt: now },
    $set: {
      lastSeenAt: now,
      language,
      ...(location ? { location } : {}),
    },
    $addToSet: { visitedDays: todayDateString(now) },
    $inc: { eventsCounter: 1 },
    ...(newConcern ? { $push: { healthConcerns: { concern: newConcern, detectedAt: now } } } : {}),
  };

  await db.collection("commerce_visitors").updateOne(
    { visitorId },
    update as unknown as UpdateFilter<Document>,
    { upsert: true },
  );
}

const ESCALATING_DECISIONS = new Set(["HANDOFF", "SAFETY"]);

export async function recordMessageTurn(
  input: CommerceChatRequest,
  result: CommerceChatResponse,
  options: { ip?: string } = {},
): Promise<void> {
  try {
    const db = await database();
    if (!db) return;
    const now = new Date();
    const conversationId = input.conversationId;

    const isEscalating = ESCALATING_DECISIONS.has(result.decision);
    // An aggregation-pipeline update (not a plain update document) so a brand-new
    // conversation whose very first turn already escalates doesn't try to set
    // resolutionStatus via both $setOnInsert and $set at once — Mongo rejects that
    // as a path conflict. This form also correctly keeps a conversation "escalated"
    // once it has been, instead of a later non-escalating turn silently reverting it.
    await db.collection("commerce_conversations").updateOne(
      { conversationId },
      [
        {
          $set: {
            conversationId: { $ifNull: ["$conversationId", conversationId] },
            visitorId: { $ifNull: ["$visitorId", input.visitorId] },
            channel: { $ifNull: ["$channel", input.channel] },
            startedAt: { $ifNull: ["$startedAt", now] },
            feedback: { $ifNull: ["$feedback", null] },
            leadCaptured: { $ifNull: ["$leadCaptured", false] },
            language: input.language,
            pageContext: input.pageContext ?? null,
            lastMessageAt: now,
            resolutionStatus: isEscalating ? "escalated" : { $ifNull: ["$resolutionStatus", "resolved"] },
            intents: { $setUnion: [{ $ifNull: ["$intents", []] }, [result.category]] },
          },
        },
      ],
      { upsert: true },
    );

    const assistantDocs = result.messages.map((message, index) => ({
      conversationId,
      role: "assistant" as const,
      text: message.text,
      category: result.category,
      decision: result.decision,
      createdAt: now,
      // The widget renders every text bubble first, then the product cards and
      // handoff buttons once at the end — attach them to the last bubble so the
      // dashboard transcript can reproduce that same order and grouping exactly.
      ...(index === result.messages.length - 1 ? {
        recommendedProducts: result.recommendedProducts,
        handoff: result.handoff,
      } : {}),
    }));
    await db.collection("commerce_messages").insertMany([
      {
        conversationId,
        role: "user",
        text: input.message,
        createdAt: now,
      },
      ...assistantDocs,
    ]);

    const healthConcern = disclosedCondition(input.message);
    await touchVisitor(
      input.visitorId,
      input.language,
      {
        ...(options.ip !== undefined ? { ip: options.ip } : {}),
        ...(healthConcern ? { healthConcern } : {}),
      },
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

export interface DateRange {
  from?: Date;
  to?: Date;
}

function dateRangeFilter(range: DateRange): Record<string, unknown> {
  if (!range.from && !range.to) return {};
  const startedAt: Record<string, Date> = {};
  if (range.from) startedAt.$gte = range.from;
  if (range.to) startedAt.$lte = range.to;
  return { startedAt };
}

export async function listConversations(range: DateRange & { limit?: number } = {}): Promise<Document[]> {
  const db = await database();
  if (!db) return [];
  return db.collection("commerce_conversations")
    .find(dateRangeFilter(range))
    .sort({ lastMessageAt: -1 })
    .limit(Math.min(Math.max(range.limit ?? 50, 1), 200))
    .toArray();
}

export interface ConversationDetail {
  conversation: Document;
  messages: Document[];
  visitor: Document | null;
}

export async function getConversationDetail(conversationId: string): Promise<ConversationDetail | null> {
  const db = await database();
  if (!db) return null;
  const conversation = await db.collection("commerce_conversations").findOne({ conversationId });
  if (!conversation) return null;
  const messages = await db.collection("commerce_messages")
    .find({ conversationId })
    .sort({ createdAt: 1 })
    .toArray();
  const visitor = conversation.visitorId
    ? await db.collection("commerce_visitors").findOne({ visitorId: conversation.visitorId })
    : null;
  return { conversation, messages, visitor };
}

export interface CommerceOverview {
  totalConversations: number;
  resolvedCount: number;
  escalatedCount: number;
  resolutionRate: number;
  leadCaptures: number;
  addToCartAssisted: number;
  interactionRate: number;
  thumbsUp: number;
  thumbsDown: number;
  topIntents: Array<{ intent: string; count: number }>;
  topPages: Array<{ page: string; count: number }>;
  topTrafficSources: Array<{ source: string; count: number }>;
  topHealthConcerns: Array<{ concern: string; count: number }>;
  handoffReasons: Array<{ reason: string; count: number }>;
  productRecommendations: Array<{ productSlug: string; recommended: number; clicked: number; clickThroughRate: number }>;
}

function pathFromUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return url.pathname === "/" ? "homepage" : url.pathname;
  } catch {
    return rawUrl;
  }
}

function utmSourceFromUrl(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).searchParams.get("utm_source");
  } catch {
    return null;
  }
}

function topCounts(values: Array<string | null | undefined>, limit = 5): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

export async function getOverview(range: DateRange = {}): Promise<CommerceOverview> {
  const empty: CommerceOverview = {
    totalConversations: 0,
    resolvedCount: 0,
    escalatedCount: 0,
    resolutionRate: 0,
    leadCaptures: 0,
    addToCartAssisted: 0,
    interactionRate: 0,
    thumbsUp: 0,
    thumbsDown: 0,
    topIntents: [],
    topPages: [],
    topTrafficSources: [],
    topHealthConcerns: [],
    handoffReasons: [],
    productRecommendations: [],
  };
  const db = await database();
  if (!db) return empty;
  const messageDateFilter = range.from || range.to
    ? { createdAt: { ...(range.from ? { $gte: range.from } : {}), ...(range.to ? { $lte: range.to } : {}) } }
    : {};

  const [
    [conversationResult],
    conversationPages,
    handoffMessages,
    recommendationCounts,
    clickCounts,
    addToCartCount,
    healthConcernResult,
    pageviewVisitorCount,
    conversationVisitorCount,
  ] = await Promise.all([
    db.collection("commerce_conversations").aggregate([
      { $match: dateRangeFilter(range) },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                totalConversations: { $sum: 1 },
                resolvedCount: { $sum: { $cond: [{ $eq: ["$resolutionStatus", "resolved"] }, 1, 0] } },
                escalatedCount: { $sum: { $cond: [{ $eq: ["$resolutionStatus", "escalated"] }, 1, 0] } },
                leadCaptures: { $sum: { $cond: ["$leadCaptured", 1, 0] } },
                thumbsUp: { $sum: { $cond: [{ $eq: ["$feedback", "up"] }, 1, 0] } },
                thumbsDown: { $sum: { $cond: [{ $eq: ["$feedback", "down"] }, 1, 0] } },
              },
            },
          ],
          topIntents: [
            { $unwind: "$intents" },
            { $group: { _id: "$intents", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 },
          ],
        },
      },
    ]).toArray(),
    db.collection("commerce_conversations")
      .find({ ...dateRangeFilter(range), "pageContext.url": { $exists: true, $ne: null } }, { projection: { "pageContext.url": 1 } })
      .toArray(),
    db.collection("commerce_messages")
      .find({ ...messageDateFilter, handoff: { $ne: null } }, { projection: { handoff: 1 } })
      .toArray(),
    db.collection("commerce_messages").aggregate([
      { $match: { ...messageDateFilter, recommendedProducts: { $exists: true, $ne: [] } } },
      { $unwind: "$recommendedProducts" },
      // Older conversations (before recommendedProducts stored full objects instead of
      // plain slug strings) unwind into bare strings here, which have no .productSlug —
      // excluding null keeps that legacy data from polluting the current breakdown.
      { $match: { "recommendedProducts.productSlug": { $ne: null } } },
      { $group: { _id: "$recommendedProducts.productSlug", count: { $sum: 1 } } },
    ]).toArray(),
    db.collection("commerce_events").aggregate([
      { $match: { ...messageDateFilter, type: "product_clicked", productSlug: { $ne: null } } },
      { $group: { _id: "$productSlug", count: { $sum: 1 } } },
    ]).toArray(),
    db.collection("commerce_events").countDocuments({ ...messageDateFilter, type: "add_to_cart_clicked" }),
    db.collection("commerce_visitors").aggregate([
      { $unwind: "$healthConcerns" },
      ...(range.from || range.to ? [{ $match: {
        "healthConcerns.detectedAt": { ...(range.from ? { $gte: range.from } : {}), ...(range.to ? { $lte: range.to } : {}) },
      } }] : []),
      { $group: { _id: "$healthConcerns.concern", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]).toArray(),
    // Interaction % denominator: distinct visitors who merely loaded a page with
    // the widget installed (pageview beacon), regardless of whether they chatted.
    db.collection("commerce_events").aggregate([
      { $match: { ...messageDateFilter, type: "pageview" } },
      { $group: { _id: "$visitorId" } },
      { $count: "count" },
    ]).toArray(),
    // Interaction % numerator: distinct visitors who actually had a conversation.
    db.collection("commerce_conversations").aggregate([
      { $match: dateRangeFilter(range) },
      { $group: { _id: "$visitorId" } },
      { $count: "count" },
    ]).toArray(),
  ]);

  const totals = conversationResult?.totals?.[0];
  if (!totals) return empty;

  const pages = topCounts(conversationPages.map((doc) => pathFromUrl(doc.pageContext?.url ?? "")));
  const sources = topCounts(conversationPages.map((doc) => utmSourceFromUrl(doc.pageContext?.url ?? "")));
  const handoffReasonCounts = topCounts(handoffMessages.map((doc) => doc.handoff?.reason ?? null));

  const clickCountDocs = clickCounts as unknown as Array<{ _id: string; count: number }>;
  const recommendationCountDocs = recommendationCounts as unknown as Array<{ _id: string; count: number }>;
  const healthConcernDocs = healthConcernResult as unknown as Array<{ _id: string; count: number }>;
  const clicksBySlug = new Map<string, number>(clickCountDocs.map((item) => [item._id, item.count]));
  const productRecommendations = recommendationCountDocs
    .map((item) => {
      const clicked = clicksBySlug.get(item._id) ?? 0;
      return {
        productSlug: item._id,
        recommended: item.count,
        clicked,
        clickThroughRate: item.count ? Math.round((clicked / item.count) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.recommended - a.recommended)
    .slice(0, 10);

  const pageviewVisitors = (pageviewVisitorCount as unknown as Array<{ count: number }>)[0]?.count ?? 0;
  const conversationVisitors = (conversationVisitorCount as unknown as Array<{ count: number }>)[0]?.count ?? 0;

  return {
    totalConversations: totals.totalConversations ?? 0,
    resolvedCount: totals.resolvedCount ?? 0,
    escalatedCount: totals.escalatedCount ?? 0,
    resolutionRate: totals.totalConversations
      ? Math.round((totals.resolvedCount / totals.totalConversations) * 1000) / 10
      : 0,
    leadCaptures: totals.leadCaptures ?? 0,
    addToCartAssisted: addToCartCount,
    // Guards against a near-empty pageview sample (e.g. right after this beacon
    // ships) making the rate look artificially high or low from a handful of visits.
    interactionRate: pageviewVisitors ? Math.round((conversationVisitors / pageviewVisitors) * 1000) / 10 : 0,
    thumbsUp: totals.thumbsUp ?? 0,
    thumbsDown: totals.thumbsDown ?? 0,
    topIntents: (conversationResult?.topIntents ?? []).map((item: { _id: string; count: number }) => ({
      intent: item._id,
      count: item.count,
    })),
    topPages: pages.map(({ key, count }) => ({ page: key, count })),
    topTrafficSources: sources.map(({ key, count }) => ({ source: key, count })),
    topHealthConcerns: healthConcernDocs.map((item) => ({
      concern: item._id,
      count: item.count,
    })),
    handoffReasons: handoffReasonCounts.map(({ key, count }) => ({ reason: key, count })),
    productRecommendations,
  };
}
