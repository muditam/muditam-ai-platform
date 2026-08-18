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
  sourceType: "product" | "platform";
  productId?: unknown;
  productSlug?: string;
  sourceName: string;
  sourceUrl: string;
  language: "en";
  keywords: string[];
  active: boolean;
  recommendationEligible: boolean;
  version: string;
  contentHash: string;
  channels: Array<"mobile_app" | "shopify_web">;
  audiences: Array<"anonymous_visitor" | "verified_customer">;
}

interface PlatformSourceInput {
  key: string;
  title: string;
  sourceName: string;
  sourceUrl: string;
  version: string;
  chunks: Array<{ suffix: string; title: string; content: string; keywords: string[] }>;
}

export const platformKnowledgeSources: readonly PlatformSourceInput[] = [
  {
    key: "platform:muditam-overview",
    title: "About Muditam",
    sourceName: "Muditam Ayurveda — About Us",
    sourceUrl: "https://www.muditam.com/pages/about-us",
    version: "2026-08-05.1",
    chunks: [{
      suffix: "overview",
      title: "Muditam company and platform information",
      content: "Muditam Ayurveda is an India-based wellness company combining Ayurvedic herbs, nutrition, lifestyle guidance, and modern research. Its stated approach is to support wellness through natural solutions and personalized wellness plans guided by experts. Muditam products are described on its website as FSSAI and GMP certified. The Muditam mobile platform supports users with health-report tracking, general educational AI assistance, and access to human dietitian and doctor guidance. The AI assistant provides education and platform information; it does not diagnose, prescribe medicines, or decide personalized supplement dosage.",
      keywords: ["Muditam", "company", "platform", "app", "about", "Ayurveda", "wellness", "what is Muditam"],
    }],
  },
  {
    key: "platform:expert-support",
    title: "Muditam dietitian and doctor support",
    sourceName: "Muditam Ayurveda — Expert Details",
    sourceUrl: "https://www.muditam.com/pages/dietcian-details",
    version: "2026-08-05.1",
    chunks: [{
      suffix: "services",
      title: "Dietitian and doctor support at Muditam",
      content: "Muditam provides access to human experts for personalized support. Its published expert pages describe clinical dietitians and metabolic-health experts who provide personalized diet guidance and practical support for diabetes, fatty liver, obesity, and related metabolic-health concerns. Medical diagnosis, medicine changes, and clinical treatment decisions must be discussed with a qualified doctor. Personalized food plans and supplement dosage or suitability must be decided by the user's assigned dietitian or doctor, using the person's health history, reports, and current medicines.",
      keywords: ["dietitian", "doctor", "expert", "consultation", "support", "personalized diet", "metabolic health"],
    }],
  },
  {
    key: "platform:report-workflow",
    title: "Muditam report upload and analysis",
    sourceName: "Muditam Mobile Platform",
    sourceUrl: "https://www.muditam.com/",
    version: "2026-08-05.1",
    chunks: [
      {
        suffix: "upload",
        title: "How report upload works in the Muditam app",
        content: "In the Muditam mobile app, a user can upload a supported health-report document or one or more report photos. Digital PDF pages with usable embedded text are read directly. Image files, photographed pages, and PDF pages without usable text are sent through the configured vision extraction path. For a mixed PDF, readable pages and vision-required pages are processed through their appropriate paths and then merged into one report result.",
        keywords: ["report", "upload", "PDF", "photo", "image", "multiple photos", "OCR", "vision", "document"],
      },
      {
        suffix: "analysis",
        title: "How Muditam extracts and validates report values",
        content: "After report text or image content is extracted, Muditam maps laboratory test names to canonical biomarker identities, retains the reported value, unit, and reference range where available, and validates the normalized observation. Values that are absent from the report are not estimated or invented and appear as missing. If the report cannot be read reliably, the app should show empty values with a report-readability warning. If only some pages succeed, values from the successfully processed pages may still be shown. Extracted results support review and education but are not a medical diagnosis; users should compare uncertain values with the original report and discuss clinical interpretation with their dietitian or doctor.",
        keywords: ["report analysis", "extract", "biomarker", "validation", "missing value", "unreadable report", "reference range"],
      },
    ],
  },
];

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
    channels: ["mobile_app", "shopify_web"] as Array<"mobile_app" | "shopify_web">,
    audiences: ["anonymous_visitor", "verified_customer"] as Array<"anonymous_visitor" | "verified_customer">,
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

export function platformChunks(): ChunkInput[] {
  return platformKnowledgeSources.flatMap((source) => source.chunks.map((chunk) => {
    const contentHash = hash(chunk.content);
    return {
      key: `${source.key}:${chunk.suffix}`,
      title: chunk.title,
      content: chunk.content,
      sourceType: "platform" as const,
      sourceName: source.sourceName,
      sourceUrl: source.sourceUrl,
      language: "en" as const,
      keywords: chunk.keywords,
      active: true,
      recommendationEligible: false,
      version: source.version,
      contentHash,
      channels: ["mobile_app", "shopify_web"],
      audiences: ["anonymous_visitor", "verified_customer"],
    };
  }));
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
  const productKnowledgeChunks = products.flatMap(productChunks);
  const platformKnowledgeChunks = platformChunks();
  const chunks = [...productKnowledgeChunks, ...platformKnowledgeChunks];
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
    platformSources: platformKnowledgeSources.length,
    platformChunks: platformKnowledgeChunks.length,
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
    await sources.bulkWrite(platformKnowledgeSources.map((source) => ({ updateOne: {
      filter: { key: source.key },
      update: { $set: {
        key: source.key,
        sourceType: "platform",
        title: source.title,
        sourceName: source.sourceName,
        sourceUrl: source.sourceUrl,
        active: true,
        recommendationEligible: false,
        version: source.version,
        updatedAt: now,
      }, $setOnInsert: { createdAt: now } },
      upsert: true,
    } })), { ordered: false });
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
      await chunksCollection.updateMany({ sourceType: "platform", key: { $nin: platformKnowledgeChunks.map((chunk) => chunk.key) } }, { $set: { active: false, updatedAt: now } });
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
