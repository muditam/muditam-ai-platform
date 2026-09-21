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
    const explicitTags = Array.isArray(product.chatbotTags) ? product.chatbotTags.map(String).filter(Boolean) : [];
    const legacyCategory = String(product.category ?? "").trim();
    return {
      id: String(product._id),
      name: String(product.name ?? slug),
      slug,
      category: String(product.category ?? "Uncategorized"),
      productUrl: String(product.productUrl ?? product.websiteCatalog?.sourceUrl ?? `https://www.muditam.com/products/${slug}`),
      imageUrl: imageUrl(product),
      recommendationEligible: product.recommendationEligible === true,
      recommendationPriority: product.recommendationEligible !== true
        ? "hidden"
        : product.recommendationPriority === "boosted" ? "boosted" : "normal",
      visible: product.recommendationEligible === true,
      overallRank: Number.isInteger(product.chatbotOverallRank) ? Number(product.chatbotOverallRank) : null,
      tagRanks: product.chatbotTagRanks && typeof product.chatbotTagRanks === "object" ? product.chatbotTagRanks : {},
      knowledgeChunkCount: Number(knowledge?.count ?? 0),
      updatedAt: knowledge?.lastUpdatedAt ?? product.updatedAt ?? null,
      tags: explicitTags,
      legacyCategory,
      aliases: Array.isArray(product.chatbotAliases) ? product.chatbotAliases.map(String) : [],
      approvedDescription: String(product.chatbotDescription ?? ""),
      fields: {
        concern: String(product.chatbotFields?.concern ?? ""),
        keyBenefits: String(product.chatbotFields?.keyBenefits ?? ""),
        quantity: String(product.chatbotFields?.quantity ?? ""),
        usage: String(product.chatbotFields?.usage ?? ""),
        warning: String(product.chatbotFields?.warning ?? ""),
        other: String(product.chatbotFields?.other ?? ""),
        variantFormats: String(product.chatbotFields?.variantFormats ?? ""),
      },
      shopify: {
        productId: String(product.websiteCatalog?.shopifyProductId ?? ""),
        handle: String(product.websiteCatalog?.handle ?? slug),
        description: String(product.websiteCatalog?.description ?? ""),
        dosage: String(product.websiteCatalog?.publishedDosage ?? ""),
        images: Array.isArray(product.websiteCatalog?.images) ? product.websiteCatalog.images.map(String) : [],
        collections: Array.isArray(product.websiteCatalog?.collections) ? product.websiteCatalog.collections.map(String) : [],
        sourceUpdatedAt: product.websiteCatalog?.sourceUpdatedAt ?? null,
      },
      variants: Array.isArray(product.websiteCatalog?.variants) ? product.websiteCatalog.variants.map((variant: Document) => ({
        shopifyVariantId: String(variant.shopifyVariantId ?? ""),
        title: String(variant.title ?? ""),
        price: Number(variant.price ?? 0),
        compareAtPrice: variant.compareAtPrice == null ? null : Number(variant.compareAtPrice),
        available: variant.available === true,
      })) : [],
    };
  });
}

type ProductPriority = "hidden" | "normal" | "boosted";

async function recordChange(db: Awaited<ReturnType<typeof database>>, action: string, target: string, details: Document) {
  if (!db) return;
  await db.collection("commerce_bot_change_logs").insertOne({ action, target, details, createdAt: new Date() });
}

export async function updateBotFlowProduct(slug: string, value: {
  recommendationPriority: ProductPriority;
  visible?: boolean | undefined;
  overallRank: number | null;
  tagRanks: Record<string, number>;
  tags: string[];
  aliases: string[];
  approvedDescription: string;
  fields: {
    concern: string;
    keyBenefits: string;
    quantity: string;
    usage: string;
    warning: string;
    other: string;
    variantFormats: string;
  };
}) {
  const db = await database();
  if (!db) throw new Error("Knowledge database is not configured");
  const now = new Date();
  const visible = value.visible ?? value.recommendationPriority !== "hidden";
  const normalizedTags = [...new Set(value.tags.map((item) => item.trim().toLowerCase()).filter(Boolean))];
  const tagRanks = Object.fromEntries(Object.entries(value.tagRanks)
    .map(([tag, rank]) => [tag.trim().toLowerCase(), rank] as const)
    .filter(([tag]) => tag && !tag.includes(".") && !tag.startsWith("$")));
  const result = await db.collection("metabolic_products").updateOne({ slug }, { $set: {
    recommendationEligible: visible,
    recommendationPriority: visible ? "normal" : "hidden",
    chatbotOverallRank: value.overallRank,
    chatbotTagRanks: tagRanks,
    chatbotTags: normalizedTags,
    chatbotAliases: [...new Set(value.aliases.map((item) => item.trim()).filter(Boolean))],
    chatbotDescription: value.approvedDescription,
    chatbotFields: value.fields,
    chatbotConfigUpdatedAt: now,
  } });
  if (!result.matchedCount) throw new Error("Product was not found");
  await db.collection("knowledge_chunks").updateMany(
    { productSlug: slug, sourceType: "product" },
    { $set: { recommendationEligible: visible, updatedAt: now } },
  );
  await recordChange(db, "product.updated", slug, value);
  return (await listBotFlowProducts()).find((product) => product.slug === slug);
}

export async function bulkUpdateBotFlowProducts(tags: string[], recommendationPriority: ProductPriority) {
  const db = await database();
  if (!db) throw new Error("Knowledge database is not configured");
  const normalized = [...new Set(tags.map((item) => item.trim()).filter(Boolean))];
  const products = await db.collection("metabolic_products").find({
    $or: [{ chatbotTags: { $in: normalized } }, { tags: { $in: normalized } }],
  }, { projection: { slug: 1 } }).toArray();
  const slugs = products.map((product) => String(product.slug));
  if (slugs.length) {
    const now = new Date();
    await db.collection("metabolic_products").updateMany({ slug: { $in: slugs } }, { $set: {
      recommendationEligible: recommendationPriority !== "hidden",
      recommendationPriority,
      chatbotConfigUpdatedAt: now,
    } });
    await db.collection("knowledge_chunks").updateMany({ productSlug: { $in: slugs }, sourceType: "product" }, { $set: {
      recommendationEligible: recommendationPriority !== "hidden",
      updatedAt: now,
    } });
  }
  await recordChange(db, "products.bulk_updated", normalized.join(","), { tags: normalized, recommendationPriority, matched: slugs.length });
  return { matched: slugs.length, slugs };
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

export async function updateBotFlowTextData(key: string, title: string, content: string) {
  const db = await database();
  if (!db) throw new Error("Knowledge database is not configured");
  const existing = await db.collection("knowledge_chunks").findOne({ key, sourceType: "platform", managedBy: "bot_flow" });
  if (!existing) throw new Error("Editable knowledge source was not found");
  const now = new Date();
  const embedding = await createEmbedding(`${title}\n${content}`);
  await db.collection("knowledge_chunks").updateOne({ key }, { $set: {
    title, content, contentHi: content, embedding,
    contentHash: createHash("sha256").update(content).digest("hex"),
    version: now.toISOString(), updatedAt: now,
  } });
  await recordChange(db, "knowledge.updated", key, { title });
  return { ...existing, title, content, contentHi: content, version: now.toISOString(), updatedAt: now, embedding: undefined };
}

export async function deleteBotFlowTextData(key: string) {
  const db = await database();
  if (!db) throw new Error("Knowledge database is not configured");
  const result = await db.collection("knowledge_chunks").updateOne(
    { key, sourceType: "platform", managedBy: "bot_flow" },
    { $set: { active: false, updatedAt: new Date() } },
  );
  if (!result.matchedCount) throw new Error("Editable knowledge source was not found");
  await recordChange(db, "knowledge.deleted", key, {});
  return { deleted: true };
}

export async function listMissingInformation(limit = 100) {
  const db = await database();
  if (!db) return [];
  const failed = await db.collection("commerce_messages").find({
    role: "assistant",
    $or: [
      { needsReview: true },
      { decision: "REFUSE", category: { $ne: "OFF_TOPIC" } },
    ],
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
