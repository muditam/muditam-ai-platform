import { createHash, randomUUID } from "node:crypto";
import { MongoClient, type Document } from "mongodb";
import OpenAI from "openai";
import { ragConfig } from "../chat/rag.js";

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

function imageUrl(product: Document): string | null {
  const candidates = [
    product.imageUrl,
    product.featuredImage,
    product.websiteCatalog?.featuredImage,
    product.websiteCatalog?.imageUrl,
    product.websiteCatalog?.images?.[0]?.src,
    product.websiteCatalog?.images?.[0],
  ];
  return candidates.find((value) => typeof value === "string" && /^https?:\/\//.test(value)) ?? null;
}

export async function listBotFlowProducts() {
  const db = await database();
  if (!db) return [];
  const products = await db.collection("metabolic_products").find({
    active: true,
    websiteStatus: "active",
  }).sort({ name: 1 }).toArray();
  const counts = await db.collection("knowledge_chunks").aggregate([
    { $match: { sourceType: "product", active: true } },
    { $group: { _id: "$productSlug", count: { $sum: 1 }, lastUpdatedAt: { $max: "$updatedAt" } } },
  ]).toArray();
  const bySlug = new Map(counts.map((item) => [String(item._id), item]));
  return products.map((product) => {
    const slug = String(product.slug);
    const knowledge = bySlug.get(slug);
    return {
      id: String(product._id),
      name: String(product.name ?? slug),
      slug,
      category: String(product.category ?? "Uncategorized"),
      productUrl: String(product.productUrl ?? product.websiteCatalog?.sourceUrl ?? `https://www.muditam.com/products/${slug}`),
      imageUrl: imageUrl(product),
      recommendationEligible: product.recommendationEligible === true,
      knowledgeChunkCount: Number(knowledge?.count ?? 0),
      updatedAt: knowledge?.lastUpdatedAt ?? product.updatedAt ?? null,
      tags: Array.isArray(product.tags) ? product.tags.map(String) : [],
    };
  });
}

export async function listBotFlowKnowledge() {
  const db = await database();
  if (!db) return [];
  return db.collection("knowledge_chunks").find({
    sourceType: "platform",
    active: true,
  }, { projection: { embedding: 0, contentHash: 0 } }).sort({ updatedAt: -1, title: 1 }).toArray();
}

async function createEmbedding(input: string): Promise<number[]> {
  const apiKey = process.env.MUDITAM_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI API key is not configured for knowledge ingestion");
  const openai = new OpenAI({ apiKey, timeout: 20_000, maxRetries: 1 });
  const response = await openai.embeddings.create({
    model: ragConfig.embeddingModel(),
    dimensions: ragConfig.embeddingDimensions(),
    encoding_format: "float",
    input,
  });
  return response.data[0]?.embedding ?? [];
}

export async function addBotFlowTextData(title: string, content: string) {
  const db = await database();
  if (!db) throw new Error("Knowledge database is not configured");
  const now = new Date();
  const key = `platform:manual:${randomUUID()}`;
  const embedding = await createEmbedding(`${title}\n${content}`);
  const document = {
    key,
    title,
    content,
    contentHi: content,
    sourceType: "platform",
    sourceName: "Muditam Bot Flow",
    sourceUrl: "https://www.muditam.com/",
    language: "en",
    keywords: [],
    active: true,
    recommendationEligible: false,
    channels: ["mobile_app", "shopify_web"],
    audiences: ["anonymous_visitor", "verified_customer"],
    version: now.toISOString(),
    contentHash: createHash("sha256").update(content).digest("hex"),
    embedding,
    createdAt: now,
    updatedAt: now,
    managedBy: "bot_flow",
  };
  await db.collection("knowledge_chunks").insertOne(document);
  return { ...document, embedding: undefined };
}

export async function listMissingInformation(limit = 100) {
  const db = await database();
  if (!db) return [];
  const failed = await db.collection("commerce_messages").find({
    role: "assistant",
    decision: "REFUSE",
    category: { $ne: "OFF_TOPIC" },
  }, { projection: { conversationId: 1, category: 1, createdAt: 1 } })
    .sort({ createdAt: -1 }).limit(Math.min(Math.max(limit, 1), 200)).toArray();
  const items = await Promise.all(failed.map(async (message) => {
    const question = await db.collection("commerce_messages").findOne({
      conversationId: message.conversationId,
      role: "user",
      createdAt: { $lte: message.createdAt },
    }, { sort: { createdAt: -1 }, projection: { text: 1, createdAt: 1 } });
    if (!question?.text) return null;
    return {
      id: String(message._id),
      question: String(question.text),
      conversationId: String(message.conversationId),
      category: String(message.category ?? "Unknown"),
      createdAt: message.createdAt,
    };
  }));
  const unique = new Map<string, NonNullable<(typeof items)[number]>>();
  for (const item of items) {
    if (!item) continue;
    const normalized = item.question.toLowerCase().replace(/[^a-z0-9\p{L}]+/gu, " ").trim();
    if (!unique.has(normalized)) unique.set(normalized, item);
  }
  return [...unique.values()];
}

const DEFAULT_DISCOUNTS = {
  sharingMode: "disabled" as "disabled" | "relevant" | "all",
  autoUpdate: false,
  discounts: [] as Array<{
    id: string;
    code: string;
    description: string;
    value: string;
    active: boolean;
  }>,
};

export async function getDiscountConfig() {
  const db = await database();
  if (!db) return DEFAULT_DISCOUNTS;
  const stored = await db.collection("commerce_bot_settings").findOne({ key: "discounts" });
  return stored?.value ?? DEFAULT_DISCOUNTS;
}

export async function saveDiscountConfig(value: typeof DEFAULT_DISCOUNTS) {
  const db = await database();
  if (!db) throw new Error("Knowledge database is not configured");
  const normalized = {
    sharingMode: value.sharingMode,
    autoUpdate: value.autoUpdate,
    discounts: value.discounts.map((item) => ({ ...item, id: item.id || randomUUID() })),
  };
  await db.collection("commerce_bot_settings").updateOne(
    { key: "discounts" },
    { $set: { value: normalized, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true },
  );
  return normalized;
}
