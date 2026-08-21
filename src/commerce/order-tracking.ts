import { MongoClient, type Db } from "mongodb";
import type { CommerceChatRequest, CommerceChatResponse } from "./contracts.js";
import { expertHandoff } from "./expert-contact.js";

const ORDER_INTENT = /\b(?:where(?:'s| is) my order|track(?:ing)? (?:my )?order|order status|order details?|latest order|my orders?|delivery status|shipment status)\b|(?:mera|meri) order (?:kaha|kahaan|track|status|details?)|ऑर्डर (?:कहाँ|ट्रैक|स्टेटस|डिटेल)/iu;
const ORDER_NUMBER = /#?\s*(MA\d{4,})\b/iu;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const PHONE = /(?:\+?91[\s-]?)?([6-9]\d{9})\b/u;
const IDENTIFIER_CORRECTION = /\b(?:this|that|previous|last)?\s*(?:mobile|phone|contact)?\s*(?:number|no\.?)?\s*(?:is|was)?\s*(?:wrong|incorrect|invalid)|\b(?:wrong|incorrect)\s*(?:mobile|phone|contact)?\s*(?:number|no\.?)?|\bnot\s+(?:my|the right)\s+(?:mobile|phone|contact)?\s*(?:number|no\.?)?|(?:number|mobile|phone)\s+(?:galat|wrong)\s+(?:hai|tha)?/iu;
const IDENTIFIER_REPLACEMENT = /\b(?:another|different|new|other)\s+(?:mobile|phone|contact)?\s*(?:number|no\.?)\b|\b(?:dusra|doosra|naya)\s+(?:mobile|phone|contact)?\s*(?:number|no\.?)?\b/iu;
const MULTI_ORDER_REFERENCE = /\b(?:both|all(?: of them| orders?)?|these orders|each(?: one| order)?)\b|(?:dono|donon|sabhi)\b/iu;
const ALL_CUSTOMER_ORDERS = /\b(?:all (?:of )?(?:my )?orders|my orders|every order|order history)\b|(?:mere|meri) (?:sabhi|saare) orders?\b/iu;
const ORDER_CANCELLATION_REQUEST = /\b(?:can|could|would|will)\s+you\s+cancel\b.{0,30}\border\b|\b(?:please|pls)\s+cancel\b.{0,30}\border\b|\b(?:i\s+(?:want|need|would like)\s+to\s+cancel|cancel\s+my)\b.{0,30}\border\b|\b(?:order\s+cancel\s+kar(?:na|do)|mera\s+order\s+cancel)\b|(?:ऑर्डर कैंसिल)/iu;

let client: MongoClient | null = null;

function uri(): string | undefined {
  return process.env.MUDITAM_SHIPTRACK_MONGO_URI ?? process.env.SHIPTRACK_MONGODB_URI;
}

async function database(): Promise<Db | null> {
  const mongoUri = uri();
  if (!mongoUri) return null;
  client ??= new MongoClient(mongoUri, { maxPoolSize: 5, minPoolSize: 0, serverSelectionTimeoutMS: 5_000 });
  await client.connect();
  return client.db(process.env.MUDITAM_SHIPTRACK_DATABASE ?? "shiptrack");
}

function customerTurns(input: CommerceChatRequest): string[] {
  const turns = [...input.recentMessages.filter((item) => item.role === "user").slice(-6).map((item) => item.content), input.message];
  const resetAt = turns.findLastIndex((content) => IDENTIFIER_CORRECTION.test(content) || IDENTIFIER_REPLACEMENT.test(content));
  return resetAt >= 0 ? turns.slice(resetAt + 1) : turns;
}

export function orderTrackingIntent(input: CommerceChatRequest): boolean {
  const recentOrderConversation = input.recentMessages
    .slice(-8)
    .some((item) => ORDER_INTENT.test(item.content)
      || /\b(?:find|fetch|look up|pull up|check|verify)\b.{0,50}\b(?:order|shipment|delivery)\b|\b(?:order|shipment|delivery)\b.{0,50}\b(?:find|fetch|look up|pull up|check|verify)\b/iu.test(item.content));
  const recentAssistantAskedForOrder = input.recentMessages
    .filter((item) => item.role === "assistant")
    .slice(-2)
    .some((item) => /(?:please\s+)?share (?:your )?(?:correct )?(?:registered )?(?:mobile|phone|order number|order id)|checkout (?:phone|email)|ऑर्डर नंबर/iu.test(item.content));
  const recentOrderResult = input.recentMessages
    .filter((item) => item.role === "assistant")
    .slice(-2)
    .some((item) => /(?:found your (?:latest )?order|your order number is|order has been|current order status)/iu.test(item.content));
  const suppliedRequestedIdentifier = recentAssistantAskedForOrder
    && (PHONE.test(input.message) || EMAIL.test(input.message) || ORDER_NUMBER.test(input.message));
  const suppliedIdentifierInOrderConversation = recentOrderConversation
    && (PHONE.test(input.message) || EMAIL.test(input.message) || ORDER_NUMBER.test(input.message));
  const correctingRecentIdentifier = recentOrderResult && IDENTIFIER_CORRECTION.test(input.message);
  const replacingIdentifier = recentOrderConversation && IDENTIFIER_REPLACEMENT.test(input.message);
  const referencedOrderCount = conversationOrderNames(input).length;
  const requestedMultipleOrders = MULTI_ORDER_REFERENCE.test(input.message) && referencedOrderCount >= 2;
  return ORDER_INTENT.test(input.message)
    || ORDER_NUMBER.test(input.message)
    || PHONE.test(input.message)
    || EMAIL.test(input.message)
    || suppliedRequestedIdentifier
    || suppliedIdentifierInOrderConversation
    || correctingRecentIdentifier
    || replacingIdentifier
    || requestedMultipleOrders;
}

function conversationOrderNames(input: CommerceChatRequest): string[] {
  const messages = [...input.recentMessages.map((item) => item.content), input.message];
  const names: string[] = [];
  const pattern = /#?\s*(MA\d{4,})\b/giu;
  for (const message of messages) {
    for (const match of message.matchAll(pattern)) {
      const name = `#${match[1]?.toUpperCase()}`;
      if (!names.includes(name)) names.push(name);
    }
  }
  return names.slice(-5);
}

function requestsAllCustomerOrders(input: CommerceChatRequest): boolean {
  return [...input.recentMessages.filter((item) => item.role === "user").slice(-4).map((item) => item.content), input.message]
    .some((message) => ALL_CUSTOMER_ORDERS.test(message));
}

export function trackingLookupInput(input: CommerceChatRequest): { orderName: string | null; email: string | null; phone: string | null } {
  const turns = customerTurns(input);
  const newestMatch = (pattern: RegExp): RegExpMatchArray | null => {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const match = turns[index]?.match(pattern);
      if (match) return match;
    }
    return null;
  };
  const order = newestMatch(ORDER_NUMBER)?.[1]?.toUpperCase() ?? null;
  return {
    orderName: order ? `#${order}` : null,
    email: newestMatch(EMAIL)?.[0]?.toLowerCase() ?? null,
    phone: newestMatch(PHONE)?.[1] ?? null,
  };
}

function emptyResponse(text: string): CommerceChatResponse {
  return {
    decision: "ALLOW",
    category: "ORDER_OR_SUPPORT",
    messages: [{ type: "text", text }],
    recommendedProducts: [],
    knowledgeReferences: [],
    handoff: null,
    orderTracking: null,
    orderTrackings: [],
    model: null,
    promptVersion: "commerce-order-tracking-2026-08-20.1",
    guardrailStage: "INPUT",
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  };
}

function orderNotFoundResponse(text: string): CommerceChatResponse {
  return {
    ...emptyResponse(`${text}\n\nIf you still can’t find it, you can connect with Muditam support.`),
    handoff: expertHandoff("support", "Order could not be verified"),
  };
}

function normalizedPhone(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "").slice(-10);
}

function statusLabel(order: Record<string, unknown>, shipment: Record<string, unknown> | null): string {
  const normalized = String(shipment?.normalizedStatus ?? "").toUpperCase();
  const labels: Record<string, string> = {
    CREATED: "Order confirmed", PICKED_UP: "Picked up", IN_TRANSIT: "In transit",
    OUT_FOR_DELIVERY: "Out for delivery", DELIVERED: "Delivered", DELIVERY_FAILED: "Delivery attempt failed",
    RTO: "Returning to origin", CANCELLED: "Cancelled",
  };
  if (labels[normalized]) return labels[normalized];
  if (order.cancelledAt) return "Cancelled";
  if (String(order.fulfillmentStatus ?? "").toLowerCase() === "fulfilled") return "Shipped";
  return "Confirmed, awaiting shipment";
}

function orderStatusDetail(status: string, courier: string | null): string {
  if (status === "Confirmed, awaiting shipment") {
    return "Your order has not shipped yet. Once it is dispatched, you’ll receive the tracking number and tracking link.";
  }
  if (status === "In transit") return `Your order is on the way${courier ? ` with ${courier}` : ""}.`;
  if (status === "Out for delivery") return "Your order is out for delivery and should reach you soon.";
  if (status === "Delivered") return "Your order has been delivered.";
  if (status === "Cancelled") return "This order has been cancelled.";
  return `Your current order status is ${status.toLowerCase()}.`;
}

type TrackingResult = NonNullable<CommerceChatResponse["orderTracking"]>;
export type OrderTrackingLookup = (lookup: { orderName: string | null; email: string | null; phone: string | null }) => Promise<TrackingResult | "NOT_FOUND" | "IDENTITY_MISMATCH" | "UNAVAILABLE">;
export type CustomerOrdersLookup = (lookup: { email: string | null; phone: string | null }) => Promise<TrackingResult[] | "NOT_FOUND" | "UNAVAILABLE">;

export async function lookupTrackedOrder({ orderName, email, phone }: { orderName: string | null; email: string | null; phone: string | null }): ReturnType<OrderTrackingLookup> {
  try {
    const db = await database();
    if (!db) return "UNAVAILABLE";
    const shopDomain = process.env.MUDITAM_SHIPTRACK_SHOP_DOMAIN ?? "muditam.myshopify.com";
    const phoneCandidates = phone ? [phone, `91${phone}`, `+91${phone}`] : [];
    const identifierQuery = orderName
      ? { orderName }
      : email
        ? { email: { $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } }
        : { phone: { $in: phoneCandidates } };
    const order = await db.collection("orders").findOne({ source: "shopify", shopDomain, ...identifierQuery }, {
      sort: { shopifyCreatedAt: -1 },
      projection: { _id: 0, orderName: 1, sourceOrderId: 1, shopDomain: 1, email: 1, phone: 1, fulfillmentStatus: 1, cancelledAt: 1, trackingNumbers: 1, fulfillmentTracking: 1, lineItems: 1, shopifyCreatedAt: 1 },
    });
    if (!order) return "NOT_FOUND";
    if (orderName && (email || phone)) {
      const emailMatches = email && String(order.email ?? "").toLowerCase() === email;
      const phoneMatches = phone && normalizedPhone(order.phone) === normalizedPhone(phone);
      if (!emailMatches && !phoneMatches) return "IDENTITY_MISMATCH";
    }
    const shipment = await db.collection("shipments").findOne({
      orderSourceId: String(order.sourceOrderId),
      $or: [{ shopDomain: order.shopDomain }, { accountShopDomain: order.shopDomain }],
    }, { sort: { latestEventAt: -1 }, projection: { _id: 0, rawPayload: 0, scans: 0 } });
    const tracking = Array.isArray(order.fulfillmentTracking) ? order.fulfillmentTracking[0] : null;
    const courier = String(shipment?.provider ?? tracking?.company ?? "").toUpperCase() || null;
    const status = statusLabel(order, shipment);
    return {
      orderName: String(order.orderName),
      status,
      statusDetail: orderStatusDetail(status, courier),
      productNames: Array.isArray(order.lineItems)
        ? [...new Set(order.lineItems.map((item) => String(item?.title ?? "").trim()).filter(Boolean))].slice(0, 4)
        : [],
      placedAt: order.shopifyCreatedAt ? new Date(order.shopifyCreatedAt as string | Date).toISOString() : null,
      courier,
      trackingNumberMasked: shipment?.awbNumber ? `••••${String(shipment.awbNumber).slice(-4)}` : null,
      currentLocation: shipment?.currentLocation ? String(shipment.currentLocation) : null,
      expectedDeliveryDate: shipment?.expectedDeliveryDate ? new Date(shipment.expectedDeliveryDate as string | Date).toISOString() : null,
      latestEventAt: shipment?.latestEventAt ? new Date(shipment.latestEventAt as string | Date).toISOString() : null,
    };
  } catch (error) {
    console.error(JSON.stringify({
      service: "muditam-ai-platform",
      event: "commerce_order_tracking.unavailable",
      error: error instanceof Error ? error.message : String(error),
    }));
    await client?.close().catch(() => {});
    client = null;
    return "UNAVAILABLE";
  }
}

export async function lookupTrackedOrdersForCustomer(
  { email, phone }: { email: string | null; phone: string | null },
): ReturnType<CustomerOrdersLookup> {
  try {
    const db = await database();
    if (!db) return "UNAVAILABLE";
    const shopDomain = process.env.MUDITAM_SHIPTRACK_SHOP_DOMAIN ?? "muditam.myshopify.com";
    const phoneCandidates = phone ? [phone, `91${phone}`, `+91${phone}`] : [];
    const identifierQuery = email
      ? { email: { $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } }
      : { phone: { $in: phoneCandidates } };
    const orders = await db.collection("orders").find(
      { source: "shopify", shopDomain, ...identifierQuery },
      { projection: { _id: 0, orderName: 1 }, sort: { shopifyCreatedAt: -1 }, limit: 10 },
    ).toArray();
    if (!orders.length) return "NOT_FOUND";
    const results = await Promise.all(orders.map((order) => lookupTrackedOrder({
      orderName: String(order.orderName),
      email,
      phone,
    })));
    const verified = results.filter((item): item is TrackingResult => typeof item !== "string");
    return verified.length ? verified : "NOT_FOUND";
  } catch (error) {
    console.error(JSON.stringify({
      service: "muditam-ai-platform",
      event: "commerce_customer_orders.unavailable",
      error: error instanceof Error ? error.message : String(error),
    }));
    return "UNAVAILABLE";
  }
}

export async function deterministicOrderTracking(
  input: CommerceChatRequest,
  lookup: OrderTrackingLookup = lookupTrackedOrder,
  lookupCustomerOrders: CustomerOrdersLookup = lookupTrackedOrdersForCustomer,
): Promise<CommerceChatResponse | null> {
  if (ORDER_CANCELLATION_REQUEST.test(input.message)) {
    return {
      ...emptyResponse("Order cancellations are handled by our support team. Please connect with them by call or WhatsApp."),
      decision: "HANDOFF",
      handoff: expertHandoff("support", "Customer requested an order cancellation"),
    };
  }
  if (!orderTrackingIntent(input)) return null;
  if (IDENTIFIER_CORRECTION.test(input.message) || IDENTIFIER_REPLACEMENT.test(input.message)) {
    return emptyResponse("No problem. Please share the correct registered mobile number or order ID.");
  }
  const details = trackingLookupInput(input);
  if (requestsAllCustomerOrders(input) && (details.phone || details.email)) {
    const orders = await lookupCustomerOrders({ email: details.email, phone: details.phone });
    if (orders === "UNAVAILABLE") return emptyResponse("Order tracking is temporarily unavailable. Please try again shortly.");
    if (orders === "NOT_FOUND") return orderNotFoundResponse("I couldn’t find any orders with those details. Please check the registered mobile number or email.");
    const summary = orders.map((item) => `${item.orderName} (${item.productNames.join(", ") || "Order"}): ${item.statusDetail}`).join("\n\n");
    return { ...emptyResponse(summary), orderTracking: null, orderTrackings: orders };
  }
  const requestedOrderNames = MULTI_ORDER_REFERENCE.test(input.message) ? conversationOrderNames(input) : [];
  if (requestedOrderNames.length >= 2) {
    if (!details.phone && !details.email) {
      return emptyResponse("Please share the registered mobile number or email so I can securely verify which of these orders belong to you.");
    }
    const lookedUp = await Promise.all(requestedOrderNames.map((orderName) => lookup({
      orderName,
      email: details.email,
      phone: details.phone,
    })));
    if (lookedUp.some((item) => item === "UNAVAILABLE")) {
      return emptyResponse("Order tracking is temporarily unavailable. Please try again shortly.");
    }
    const verified = lookedUp.filter((item): item is TrackingResult => typeof item !== "string");
    if (!verified.length) {
      return orderNotFoundResponse("I couldn’t verify those orders with the available details.");
    }
    const summary = verified.map((item) => `${item.orderName} (${item.productNames.join(", ") || "Order"}): ${item.statusDetail}`).join("\n\n");
    return {
      ...emptyResponse(summary),
      orderTracking: null,
      orderTrackings: verified,
    };
  }
  if (!details.orderName && !details.email && !details.phone) {
    return emptyResponse("I can help you find it. Please share your registered mobile number or order ID.");
  }
  const result = await lookup(details);
  if (result === "NOT_FOUND" || result === "IDENTITY_MISMATCH") {
    return orderNotFoundResponse("I couldn’t verify that order with those details. Please check the order number and checkout phone or email.");
  }
  if (result === "UNAVAILABLE") return emptyResponse("Order tracking is temporarily unavailable. Please try again shortly.");
  const productText = result.productNames.length ? ` for ${result.productNames.join(", ")}` : "";
  const dateText = result.placedAt
    ? ` It was placed on ${new Date(result.placedAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}.`
    : "";
  return {
    ...emptyResponse(`Thanks, I found your latest order. Your order number is ${result.orderName}${productText}.${dateText}\n\n${result.statusDetail}`),
    orderTracking: result,
  };
}
