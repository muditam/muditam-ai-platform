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
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    client ??= new MongoClient(uri, { maxPoolSize: 5, minPoolSize: 0, serverSelectionTimeoutMS: 5_000 });
    try {
      await client.connect();
      return client.db(process.env.MUDITAM_KNOWLEDGE_DB || undefined);
    } catch (error) {
      lastError = error;
      await client.close().catch(() => {});
      client = null;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 150));
    }
  }
  throw lastError;
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

/**
 * A handoff card is often shown as a helpful fallback (refunds, pregnancy,
 * missing information, etc.). That is not an escalation until the customer
 * explicitly asks to speak with a person.
 */
export function explicitlyRequestsHumanSupport(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) return false;

  return /(?:\b(?:talk|speak|chat|connect|contact|transfer|call|whatsapp|reach)\b.{0,45}\b(?:support|agent|human|person|representative|expert|dietitian|dietician|doctor|team|someone)\b|\b(?:support|agent|human|representative|expert|dietitian|dietician|doctor)\b.{0,45}\b(?:talk|speak|chat|connect|contact|transfer|call|whatsapp|help me)\b|\b(?:live agent|human agent|customer care|customer support|talk to someone|speak to someone|connect me to someone|someone from (?:your|the) team|call me|call back|callback|need (?:human )?support|want (?:human )?support)\b|(?:support se baat|agent se baat|doctor se baat|dietitian se baat|dietician se baat|किसी से बात|सपोर्ट से बात|एजेंट से बात|डॉक्टर से बात))/iu.test(normalized);
}

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

    const isEscalating = explicitlyRequestsHumanSupport(input.message);
    const healthConcernThisTurn = disclosedCondition(input.message);
    const productSlugsThisTurn = result.recommendedProducts.map((product) => product.productSlug);
    const reviewReason = result.decision === "REFUSE" && result.category !== "OFF_TOPIC"
      ? "unanswered"
      : result.guardrailStage === "OUTPUT" && result.decision === "HANDOFF"
        ? "output_fallback"
        : result.handoff && /(?:unavailable|could not|couldn't|no verified|not verified|failed)/iu.test(result.handoff.reason)
          ? "missing_verified_information"
          : null;
    const messagesInsertedThisTurn = result.messages.length + 1; // assistant bubbles + the user's own message
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
            addedToCart: { $ifNull: ["$addedToCart", false] },
            language: input.language,
            pageContext: input.pageContext ?? null,
            lastMessageAt: now,
            explicitEscalationRequested: isEscalating
              ? true
              : { $ifNull: ["$explicitEscalationRequested", false] },
            resolutionStatus: isEscalating
              ? "escalated"
              : {
                  $cond: [
                    { $eq: [{ $ifNull: ["$explicitEscalationRequested", false] }, true] },
                    "escalated",
                    "resolved",
                  ],
                },
            intents: { $setUnion: [{ $ifNull: ["$intents", []] }, [result.category]] },
            healthConcerns: healthConcernThisTurn
              ? { $setUnion: [{ $ifNull: ["$healthConcerns", []] }, [healthConcernThisTurn]] }
              : { $ifNull: ["$healthConcerns", []] },
            recommendedProductSlugs: { $setUnion: [{ $ifNull: ["$recommendedProductSlugs", []] }, productSlugsThisTurn] },
            messageCount: { $add: [{ $ifNull: ["$messageCount", 0] }, messagesInsertedThisTurn] },
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
        needsReview: reviewReason !== null,
        reviewReason,
      } : {}),
    }));
    await db.collection("commerce_messages").insertMany([
      {
        conversationId,
        role: "user",
        text: input.message,
        explicitEscalationRequest: isEscalating,
        createdAt: now,
      },
      ...assistantDocs,
    ]);

    await touchVisitor(
      input.visitorId,
      input.language,
      {
        ...(options.ip !== undefined ? { ip: options.ip } : {}),
        ...(healthConcernThisTurn ? { healthConcern: healthConcernThisTurn } : {}),
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

    if (input.type === "add_to_cart_clicked" && input.conversationId) {
      await db.collection("commerce_conversations").updateOne(
        { conversationId: input.conversationId },
        { $set: { addedToCart: true } },
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
    if (rating === "down") {
      const latestAssistant = await db.collection("commerce_messages").findOne(
        { conversationId, role: "assistant" },
        { sort: { createdAt: -1 }, projection: { _id: 1 } },
      );
      if (latestAssistant?._id) {
        await db.collection("commerce_messages").updateOne(
          { _id: latestAssistant._id },
          { $set: { needsReview: true, reviewReason: "thumbs_down", feedbackAt: new Date() } },
        );
      }
    }
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

// Below this many total messages (user + assistant), a conversation isn't
// considered a "long chat" for the Customer Journey filter.
const LONG_CHAT_MESSAGE_THRESHOLD = 10;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface ConversationFilters {
  // Comma-separated for multi-select (OR within the group), e.g. "PRODUCT_DISCOVERY,GREETING".
  intent?: string;
  feedback?: string;
  addedToCart?: boolean;
  healthConcern?: string;
  productSlug?: string;
  longChat?: boolean;
  repeatCustomer?: boolean;
  testSession?: boolean;
}

export async function listConversations(
  range: DateRange & { limit?: number } & ConversationFilters = {},
): Promise<Document[]> {
  const db = await database();
  if (!db) return [];

  const query: Record<string, unknown> = { ...dateRangeFilter(range) };
  if (range.intent) query.intents = { $in: range.intent.split(",").map((value) => value.trim()).filter(Boolean) };
  if (range.feedback) {
    const values = range.feedback.split(",").map((value) => value.trim()).filter(Boolean);
    if (values.length) query.feedback = { $in: values };
  }
  if (range.addedToCart) query.addedToCart = true;
  if (range.healthConcern) query.healthConcerns = { $regex: escapeRegex(range.healthConcern), $options: "i" };
  if (range.productSlug) query.recommendedProductSlugs = { $regex: escapeRegex(range.productSlug), $options: "i" };
  if (range.testSession) query.channel = "internal_preview";
  if (range.longChat) query.messageCount = { $gte: LONG_CHAT_MESSAGE_THRESHOLD };

  if (range.repeatCustomer) {
    const repeatVisitors = await db.collection("commerce_conversations").aggregate([
      { $group: { _id: "$visitorId", conversationCount: { $sum: 1 } } },
      { $match: { conversationCount: { $gt: 1 } } },
    ]).toArray();
    const repeatVisitorIds = repeatVisitors.map((doc) => doc._id as string);
    if (repeatVisitorIds.length === 0) return [];
    query.visitorId = { $in: repeatVisitorIds };
  }

  const conversations = await db.collection("commerce_conversations")
    .find(query)
    .sort({ lastMessageAt: -1 })
    .limit(Math.min(Math.max(range.limit ?? 50, 1), 200))
    .toArray();

  if (conversations.length === 0) return conversations;
  const conversationIds = conversations
    .map((conversation) => conversation.conversationId)
    .filter((value): value is string => typeof value === "string");
  const userMessages = await db.collection("commerce_messages")
    .find(
      { conversationId: { $in: conversationIds }, role: "user" },
      { projection: { conversationId: 1, text: 1 } },
    )
    .toArray();
  const explicitlyEscalated = new Set(
    userMessages
      .filter((message) => typeof message.text === "string" && explicitlyRequestsHumanSupport(message.text))
      .map((message) => message.conversationId as string),
  );

  return conversations.map((conversation) => {
    const escalated = explicitlyEscalated.has(conversation.conversationId as string);
    return {
      ...conversation,
      explicitEscalationRequested: escalated,
      resolutionStatus: escalated ? "escalated" : "resolved",
    };
  });
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
  const escalated = messages.some(
    (message) => message.role === "user"
      && typeof message.text === "string"
      && explicitlyRequestsHumanSupport(message.text),
  );
  const visitor = conversation.visitorId
    ? await db.collection("commerce_visitors").findOne({ visitorId: conversation.visitorId })
    : null;
  return {
    conversation: {
      ...conversation,
      explicitEscalationRequested: escalated,
      resolutionStatus: escalated ? "escalated" : "resolved",
    },
    messages,
    visitor,
  };
}

export interface CommerceOverview {
  totalConversations: number;
  resolvedCount: number;
  escalatedCount: number;
  resolutionRate: number;
  leadCaptures: number;
  addToCartAssisted: number;
  assistedOrderValue: number;
  orderValueUtm: number;
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

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function orderCreatedAt(order: Document): Date | null {
  const value = order.shopifyCreatedAt ?? order.created_at ?? order.createdAt;
  const date = value instanceof Date ? value : typeof value === "string" || typeof value === "number" ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function orderTotal(order: Document): number {
  return numberValue(
    order.totalPrice
      ?? order.total_price
      ?? order.current_total_price
      ?? order.orderTotal
      ?? order.totalAmount,
  );
}

function orderAttribute(order: Document, key: string): string | null {
  const direct = order[key];
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const attributes = order.attributes ?? order.cartAttributes ?? order.cart_attributes ?? order.noteAttributes ?? order.note_attributes;
  if (attributes && typeof attributes === "object" && !Array.isArray(attributes)) {
    const value = (attributes as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  if (Array.isArray(attributes)) {
    for (const item of attributes) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      if ((record.name === key || record.key === key) && typeof record.value === "string" && record.value.trim()) {
        return record.value.trim();
      }
    }
  }
  return null;
}

function orderHasChatAttribution(order: Document): boolean {
  return Boolean(orderAttribute(order, "muditam_chat_conversation_id") || orderAttribute(order, "muditam_chat_visitor_id"));
}

function orderHasUtmAttribution(order: Document): boolean {
  const landingSite = typeof order.landing_site === "string" ? order.landing_site : typeof order.landingSite === "string" ? order.landingSite : "";
  const sourceUrl = orderAttribute(order, "muditam_chat_source_url") ?? landingSite;
  if (!sourceUrl) return false;
  try {
    const url = new URL(sourceUrl, "https://muditam.com");
    return Boolean(url.searchParams.get("utm_source") || url.searchParams.get("utm_campaign") || url.searchParams.get("utm_medium"));
  } catch {
    return /utm_(?:source|campaign|medium)=/iu.test(sourceUrl);
  }
}

export async function getOverview(range: DateRange = {}): Promise<CommerceOverview> {
  const empty: CommerceOverview = {
    totalConversations: 0,
    resolvedCount: 0,
    escalatedCount: 0,
    resolutionRate: 0,
    leadCaptures: 0,
    addToCartAssisted: 0,
    assistedOrderValue: 0,
    orderValueUtm: 0,
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
    attributedOrders,
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
                resolvedCount: {
                  $sum: { $cond: [{ $ne: ["$explicitEscalationRequested", true] }, 1, 0] },
                },
                escalatedCount: {
                  $sum: { $cond: [{ $eq: ["$explicitEscalationRequested", true] }, 1, 0] },
                },
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
    db.collection("commerce_events").countDocuments({ ...messageDateFilter, type: { $in: ["add_to_cart_clicked", "product_added_to_cart"] } }),
    db.collection("orders")
      .find(
        range.from || range.to
          ? { $or: [{ shopifyCreatedAt: messageDateFilter.createdAt }, { createdAt: messageDateFilter.createdAt }] }
          : {},
        {
          projection: {
            _id: 0,
            totalPrice: 1,
            total_price: 1,
            current_total_price: 1,
            orderTotal: 1,
            totalAmount: 1,
            shopifyCreatedAt: 1,
            created_at: 1,
            createdAt: 1,
            landing_site: 1,
            landingSite: 1,
            attributes: 1,
            cartAttributes: 1,
            cart_attributes: 1,
            noteAttributes: 1,
            note_attributes: 1,
            muditam_chat_conversation_id: 1,
            muditam_chat_visitor_id: 1,
          },
        },
      )
      .toArray(),
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
  const orderDocs = attributedOrders as Document[];
  const filteredOrders = orderDocs.filter((order) => {
    const createdAt = orderCreatedAt(order);
    if (!createdAt) return true;
    if (range.from && createdAt < range.from) return false;
    if (range.to && createdAt > range.to) return false;
    return true;
  });
  const assistedOrderValue = filteredOrders
    .filter(orderHasChatAttribution)
    .reduce((sum, order) => sum + orderTotal(order), 0);
  const orderValueUtm = filteredOrders
    .filter(orderHasUtmAttribution)
    .reduce((sum, order) => sum + orderTotal(order), 0);

  return {
    totalConversations: totals.totalConversations ?? 0,
    resolvedCount: totals.resolvedCount ?? 0,
    escalatedCount: totals.escalatedCount ?? 0,
    resolutionRate: totals.totalConversations
      ? Math.round((totals.resolvedCount / totals.totalConversations) * 1000) / 10
      : 0,
    leadCaptures: totals.leadCaptures ?? 0,
    addToCartAssisted: addToCartCount,
    assistedOrderValue: Math.round(assistedOrderValue * 100) / 100,
    orderValueUtm: Math.round(orderValueUtm * 100) / 100,
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
