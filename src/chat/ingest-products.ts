import crypto from "node:crypto";
import { MongoClient, type Document } from "mongodb";
import OpenAI from "openai";
import { ragConfig } from "./rag.js";

const APPLY = process.argv.includes("--apply");
const CREATE_INDEX = process.argv.includes("--create-index");
const uri = process.env.MUDITAM_MONGO_URI ?? process.env.MONGO_URI;
const apiKey = process.env.MUDITAM_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;

interface ChunkInput {
  key: string;
  title: string;
  content: string;
  sourceType: "product";
  productId: unknown;
  productSlug: string;
  sourceName: string;
  sourceUrl: string;
  language: "en";
  keywords: string[];
  active: boolean;
  recommendationEligible: boolean;
  version: string;
  contentHash: string;
}

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function productChunks(product: Document): ChunkInput[] {
  if (!product.websiteCatalog || product.websiteStatus !== "active") return [];
  const sourceUrl = String(product.productUrl || product.websiteCatalog.sourceUrl);
  const version = String(product.websiteCatalog.contentHash || product.catalogVersion || "unknown");
  const base = {
    sourceType: "product" as const,
    productId: product._id,
    productSlug: String(product.slug),
    sourceName: "Muditam Ayurveda",
    sourceUrl,
    language: "en" as const,
    active: product.active === true && product.websiteStatus === "active",
    recommendationEligible: product.recommendationEligible === true,
    version,
  };
  const overview = [
    `Product: ${product.name}`,
    `Category: ${product.category}`,
    product.websiteCatalog.description && `Published description: ${product.websiteCatalog.description}`,
    product.indication && `Indication: ${product.indication}`,
    product.composition && `Composition: ${product.composition}`,
    strings(product.keyIngredients).length && `Key ingredients: ${strings(product.keyIngredients).join(", ")}`,
    strings(product.applicableBiomarkers).length && `Applicable biomarkers: ${strings(product.applicableBiomarkers).join(", ")}`,
  ].filter(Boolean).join("\n");
  const safety = [
    `Product: ${product.name}`,
    strings(product.contraindications).length && `Contraindications: ${strings(product.contraindications).join(" ")}`,
    strings(product.safetyNotes).length && `Safety notes: ${strings(product.safetyNotes).join(" ")}`,
    "Personalized dosage is not provided by the AI assistant and must be decided by a Muditam dietitian or doctor.",
  ].filter(Boolean).join("\n");
  const make = (suffix: string, title: string, content: string, keywords: string[]): ChunkInput => ({
    ...base,
    key: `product:${product.slug}:${suffix}`,
    title,
    content,
    keywords,
    contentHash: hash(content),
  });
  const chunks = [
    make("overview", `${product.name} — product information`, overview, [product.name, product.category, ...strings(product.keyIngredients)]),
    make("safety", `${product.name} — safety information`, safety, [product.name, "safety", "contraindications"]),
  ];
  for (const [index, faq] of (product.websiteCatalog.faqs || []).entries()) {
    if (!faq?.question || !faq?.answer) continue;
    chunks.push(make(
      `faq-${index + 1}`,
      `${product.name} — ${faq.question}`,
      `Product: ${product.name}\nQuestion: ${faq.question}\nPublished answer: ${faq.answer}`,
      [product.name, faq.question],
    ));
  }
  return chunks.filter((chunk) => chunk.content.length >= 20);
}

async function embeddings(client: OpenAI, inputs: string[]): Promise<number[][]> {
  const output: number[][] = [];
  for (let index = 0; index < inputs.length; index += 64) {
    const batch = inputs.slice(index, index + 64);
    const response = await client.embeddings.create({
      model: ragConfig.embeddingModel(),
      dimensions: ragConfig.embeddingDimensions(),
      encoding_format: "float",
      input: batch,
    });
    output.push(...response.data.sort((left, right) => left.index - right.index).map((item) => item.embedding));
  }
  return output;
}

async function ensureVectorIndex(collection: ReturnType<ReturnType<MongoClient["db"]>["collection"]>) {
  const name = process.env.MUDITAM_VECTOR_INDEX ?? "muditam_knowledge_vector";
  const existing = await collection.listSearchIndexes(name).toArray();
  if (existing.length) return { name, created: false };
  await collection.createSearchIndex({
    name,
    type: "vectorSearch",
    definition: { fields: [
      { type: "vector", path: "embedding", numDimensions: ragConfig.embeddingDimensions(), similarity: "cosine" },
      { type: "filter", path: "active" },
      { type: "filter", path: "recommendationEligible" },
      { type: "filter", path: "sourceType" },
    ] },
  });
  return { name, created: true };
}

async function main() {
  if (!uri) throw new Error("MUDITAM_MONGO_URI or MONGO_URI is required");
  if (APPLY && !apiKey) throw new Error("MUDITAM_OPENAI_API_KEY or OPENAI_API_KEY is required");
  const mongo = new MongoClient(uri);
  await mongo.connect();
  const db = mongo.db(process.env.MUDITAM_KNOWLEDGE_DB || undefined);
  const products = await db.collection("metabolic_products").find({}).toArray();
  const sources = db.collection("knowledge_sources");
  const chunksCollection = db.collection("knowledge_chunks");
  const chunks = products.flatMap(productChunks);
  const existing = await chunksCollection.find({ key: { $in: chunks.map((chunk) => chunk.key) } }, {
    projection: { key: 1, contentHash: 1, embeddingModel: 1, embeddingDimensions: 1 },
  }).toArray();
  const existingByKey = new Map(existing.map((item) => [item.key, item]));
  const changed = chunks.filter((chunk) => {
    const prior = existingByKey.get(chunk.key);
    return !prior || prior.contentHash !== chunk.contentHash || prior.embeddingModel !== ragConfig.embeddingModel() || prior.embeddingDimensions !== ragConfig.embeddingDimensions();
  });
  const vectors = APPLY && changed.length ? await embeddings(new OpenAI({ apiKey: apiKey!, timeout: 30_000, maxRetries: 2 }), changed.map((chunk) => chunk.content)) : [];
  const vectorByKey = new Map(changed.map((chunk, index) => [chunk.key, vectors[index]]));
  const report: Record<string, unknown> = {
    mode: APPLY ? "apply" : "dry-run",
    database: db.databaseName,
    products: products.length,
    eligibleProducts: products.filter((product) => product.recommendationEligible === true).length,
    chunks: chunks.length,
    changedChunks: changed.length,
    embeddingModel: ragConfig.embeddingModel(),
    embeddingDimensions: ragConfig.embeddingDimensions(),
  };
  if (APPLY) {
    const now = new Date();
    if (products.length) {
      await sources.bulkWrite(products.map((product) => ({ updateOne: {
        filter: { key: `product:${product.slug}` },
        update: { $set: {
          key: `product:${product.slug}`,
          sourceType: "product",
          productId: product._id,
          productSlug: product.slug,
          title: product.name,
          sourceName: "Muditam Ayurveda",
          sourceUrl: product.productUrl || null,
          active: product.active === true && product.websiteStatus === "active",
          recommendationEligible: product.recommendationEligible === true,
          version: product.websiteCatalog?.contentHash || product.catalogVersion,
          updatedAt: now,
        }, $setOnInsert: { createdAt: now } },
        upsert: true,
      } })), { ordered: false });
    }
    if (chunks.length) {
      await chunksCollection.bulkWrite(chunks.map((chunk) => ({ updateOne: {
        filter: { key: chunk.key },
        update: { $set: {
          ...chunk,
          ...(vectorByKey.has(chunk.key) ? { embedding: vectorByKey.get(chunk.key) } : {}),
          embeddingModel: ragConfig.embeddingModel(),
          embeddingDimensions: ragConfig.embeddingDimensions(),
          updatedAt: now,
        }, $setOnInsert: { createdAt: now } },
        upsert: true,
      } })), { ordered: false });
      await chunksCollection.updateMany({ sourceType: "product", key: { $nin: chunks.map((chunk) => chunk.key) } }, { $set: { active: false, recommendationEligible: false, updatedAt: now } });
    }
    await Promise.all([
      sources.createIndex({ key: 1 }, { unique: true }),
      chunksCollection.createIndex({ key: 1 }, { unique: true }),
      chunksCollection.createIndex({ content: "text", title: "text", keywords: "text" }, { name: "knowledge_text" }),
      chunksCollection.createIndex({ sourceType: 1, active: 1, recommendationEligible: 1 }),
    ]);
    if (CREATE_INDEX) report.vectorIndex = await ensureVectorIndex(chunksCollection);
    report.embeddedChunks = changed.length;
  }
  console.log(JSON.stringify(report, null, 2));
  await mongo.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
