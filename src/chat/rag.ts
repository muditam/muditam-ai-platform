import { MongoClient, type Document } from "mongodb";
import OpenAI from "openai";
import { fuzzyIntent } from "../internal/fuzzy-match.js";
import type { KnowledgeEntry } from "./knowledge.js";

const PRODUCT_INTENT = /\b(product|products|supplement|supplements|ingredient|ingredients|price|buy|purchase|fizz|defend|fix|fuel|essentials|dense|snooze|shilajit|berberine|karela|jamun|ras|vati|gut|liver|heart|thyroid|nerve|bone|sleep)\b|(प्रोडक्ट|उत्पाद|सप्लीमेंट|सामग्री|कीमत|खरीद|शिलाजीत|करेला|जामुन|लिवर|हार्ट|थायराइड|नींद)/iu;
const PLATFORM_INTENT = /\b(muditam|company|platform|app|service|services|dietitian|dietician|doctor support|expert|consultation|upload(?:ed|ing)? (?:a )?report|report upload|analy[sz](?:e|ed|ing|is) (?:my |a |the )?report|how (?:does|do) (?:the )?report|ocr|multiple (?:report )?photos)\b|(मुदितम|कंपनी|प्लेटफॉर्म|एप|सेवा|डाइटिशियन|डायटीशियन|डॉक्टर|विशेषज्ञ|परामर्श|रिपोर्ट अपलोड|रिपोर्ट एनालिसिस|रिपोर्ट कैसे)/iu;
const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_DIMENSIONS = 1024;

let mongoClient: MongoClient | null = null;

function enabled(): boolean {
  return String(process.env.MUDITAM_RAG_ENABLED ?? "true").toLowerCase() !== "false";
}

function mongoUri(): string | undefined {
  return process.env.MUDITAM_MONGO_URI ?? process.env.MONGO_URI;
}

function embeddingModel(): string {
  return process.env.MUDITAM_EMBEDDING_MODEL ?? DEFAULT_MODEL;
}

function embeddingDimensions(): number {
  const parsed = Number.parseInt(process.env.MUDITAM_EMBEDDING_DIMENSIONS ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 256 && parsed <= 3072 ? parsed : DEFAULT_DIMENSIONS;
}

async function database() {
  const uri = mongoUri();
  if (!uri) return null;
  mongoClient ??= new MongoClient(uri, { maxPoolSize: 5, minPoolSize: 0, serverSelectionTimeoutMS: 5_000 });
  await mongoClient.connect();
  return mongoClient.db(process.env.MUDITAM_KNOWLEDGE_DB || undefined);
}

async function queryEmbedding(question: string): Promise<number[]> {
  const apiKey = process.env.MUDITAM_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI API key is not configured for RAG");
  const client = new OpenAI({ apiKey, timeout: 20_000, maxRetries: 1 });
  const response = await client.embeddings.create({
    model: embeddingModel(),
    input: question,
    dimensions: embeddingDimensions(),
    encoding_format: "float",
  });
  return response.data[0]?.embedding ?? [];
}

function toKnowledgeEntry(item: Document): KnowledgeEntry {
  return {
    key: String(item.key),
    title: String(item.title),
    content: String(item.content),
    contentHi: String(item.contentHi || item.content),
    keywords: Array.isArray(item.keywords) ? item.keywords.map(String) : [],
    sourceName: String(item.sourceName || "Muditam Ayurveda"),
    sourceUrl: String(item.sourceUrl),
    version: String(item.version),
    sourceType: item.sourceType === "platform" ? "platform" : "product",
    ...(item.productSlug ? { productSlug: String(item.productSlug) } : {}),
    recommendationEligible: item.recommendationEligible === true,
  };
}

async function vectorResults(question: string, sourceType: "product" | "platform"): Promise<KnowledgeEntry[]> {
  const db = await database();
  if (!db) return [];
  const embedding = await queryEmbedding(question);
  if (!embedding.length) return [];
  const index = process.env.MUDITAM_VECTOR_INDEX ?? "muditam_knowledge_vector";
  const rows = await db.collection("knowledge_chunks").aggregate([
    { $vectorSearch: {
      index,
      path: "embedding",
      queryVector: embedding,
      numCandidates: 100,
      limit: 6,
      filter: sourceType === "product"
        ? { active: true, recommendationEligible: true, sourceType }
        : { active: true, sourceType },
    } },
    { $project: { embedding: 0, score: { $meta: "vectorSearchScore" } } },
    { $match: { score: { $gte: 0.35 } } },
  ]).toArray();
  return rows.map(toKnowledgeEntry);
}

function searchTerms(question: string): string[] {
  return [...new Set(question.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])]
    .filter((term) => term.length >= 3)
    .slice(0, 12);
}

function expandCommerceProductQuery(question: string): string {
  const expansions: string[] = [];
  if (/\b(?:diabetes|diabetic|blood sugar|glucose|sugar patient)\b|(?:डायबिटीज|मधुमेह|ब्लड शुगर)/iu.test(question)) {
    expansions.push("blood sugar glucose metabolic support karela jamun sugar defend berberine");
  }
  if (/\b(?:fatty liver|liver)\b|(?:लिवर|जिगर)/iu.test(question)) {
    expansions.push("liver wellness support liver defend");
  }
  if (/\b(?:heart|cardiac)\b|(?:हार्ट|दिल)/iu.test(question)) {
    expansions.push("heart cardiac cardiovascular wellness support heart defend");
  }
  return [question, ...expansions].join("\n");
}

function latestCustomerMessage(question: string): string {
  return question.match(/(?:^|\n)user:\s*([^\n]+)\s*$/iu)?.[1] ?? question;
}

const bestSellerPattern = /\b(?:best[- ]?sell(?:er|ing)?|top[- ]?sell(?:er|ing)?|most (?:popular|sold|selling))\b|(?:सबसे ज़्यादा बिकने वाला|बेस्ट सेलर)/iu;

function discoveryProductSlugs(question: string): string[] {
  const latest = latestCustomerMessage(question);
  // Checked before the general product-intent gate below since "what's your best
  // seller" doesn't contain any of those words, but still needs to force-fetch the
  // bestseller product's knowledge so the deterministic bestseller guardrail has it.
  if (bestSellerPattern.test(latest)) return ["karela-jamun-fizz"];
  const asksForProduct = fuzzyIntent(latest, ["product", "products", "supplement", "something", "anything", "recommend"])
    || /\b(?:kuch|chahiye)\b|(?:प्रोडक्ट|उत्पाद|सप्लीमेंट|कुछ)/iu.test(latest);
  if (!asksForProduct) return [];
  if (/\b(?:diabetes|diabetic|blood sugar|glucose|sugar patient)\b|(?:डायबिटीज|मधुमेह|ब्लड शुगर)/iu.test(latest)) {
    return ["sugar-defend-pro", "karela-jamun-fizz"];
  }
  if (/\b(?:heart|cardiac)\b|(?:हार्ट|दिल)/iu.test(latest)) return ["heart-defend-pro"];
  if (/\b(?:fatty liver|liver|lever)\b|(?:लिवर|जिगर)/iu.test(latest)) return ["liver-defend-pro"];
  return [];
}

function normalizedProductName(value: string): string {
  return value.toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b\d+\s*(?:sachets?|tablets?|capsules?|bottles?|months?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function explicitlyReferencedProduct(question: string): Promise<{ slug: string; eligible: boolean } | null> {
  if (!enabled() || !mongoUri() || !PRODUCT_INTENT.test(question)) return null;
  const db = await database();
  if (!db) return null;
  const normalizedQuestion = ` ${normalizedProductName(question)} `;
  const products = await db.collection("metabolic_products").find({}, {
    projection: { name: 1, slug: 1, active: 1, recommendationEligible: 1, websiteStatus: 1 },
  }).toArray();
  const candidates = products
    .map((product) => ({ product, name: normalizedProductName(String(product.name)) }))
    .filter(({ name }) => name.length >= 5 && normalizedQuestion.includes(` ${name} `))
    .sort((left, right) => right.name.length - left.name.length);
  const match = candidates[0]?.product;
  if (!match) return null;
  return {
    slug: String(match.slug),
    eligible: match.active === true && match.recommendationEligible === true && match.websiteStatus === "active",
  };
}

async function exactProductResults(productSlug: string, question: string): Promise<KnowledgeEntry[]> {
  const db = await database();
  if (!db) return [];
  const terms = searchTerms(question);
  const rows = await db.collection("knowledge_chunks").find({
    productSlug,
    sourceType: "product",
    active: true,
    recommendationEligible: true,
  }, { projection: { embedding: 0 } }).toArray();
  return rows
    .map((row) => ({
      row,
      score: terms.reduce((score, term) => score + (String(row.title).toLowerCase().includes(term) ? 3 : 0) + (String(row.content).toLowerCase().includes(term) ? 1 : 0), 0),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 6)
    .map(({ row }) => toKnowledgeEntry(row));
}

async function lexicalResults(question: string, sourceType: "product" | "platform"): Promise<KnowledgeEntry[]> {
  const db = await database();
  if (!db) return [];
  const collection = db.collection("knowledge_chunks");
  const base = sourceType === "product"
    ? { active: true, recommendationEligible: true, sourceType }
    : { active: true, sourceType };
  let rows: Document[] = [];
  try {
    rows = await collection.find({ ...base, $text: { $search: question } }, { projection: { embedding: 0 } })
      .sort({ score: { $meta: "textScore" } }).limit(6).toArray();
  } catch {
    const terms = searchTerms(question).map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (terms.length) {
      rows = await collection.find({ ...base, content: { $regex: terms.join("|"), $options: "i" } }, { projection: { embedding: 0 } })
        .limit(6).toArray();
    }
  }
  return rows.map(toKnowledgeEntry);
}

export async function retrieveRagKnowledge(
  question: string,
  curated: KnowledgeEntry[] = [],
): Promise<KnowledgeEntry[]> {
  const wantsProducts = PRODUCT_INTENT.test(question);
  const wantsPlatform = PLATFORM_INTENT.test(question);
  if (!enabled() || !mongoUri() || (!wantsProducts && !wantsPlatform)) return curated;
  let retrieved: KnowledgeEntry[] = [];
  try {
    if (wantsProducts) {
      const explicitlyNamed = await explicitlyReferencedProduct(question);
      if (explicitlyNamed && !explicitlyNamed.eligible) return curated;
      retrieved.push(...(explicitlyNamed
        ? await exactProductResults(explicitlyNamed.slug, question)
        : await vectorResults(question, "product")));
    }
    if (wantsPlatform) retrieved.push(...await vectorResults(question, "platform"));
  } catch (error) {
    console.warn(JSON.stringify({
      service: "muditam-ai-platform",
      event: "rag.vector_search_fallback",
      error: error instanceof Error ? error.message : String(error),
    }));
    try {
      if (wantsProducts) retrieved.push(...await lexicalResults(question, "product"));
      if (wantsPlatform) retrieved.push(...await lexicalResults(question, "platform"));
    } catch (fallbackError) {
      console.error(JSON.stringify({
        service: "muditam-ai-platform",
        event: "rag.retrieval_failed",
        error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
      }));
    }
  }
  const unique = new Map([...curated, ...retrieved].map((item) => [item.key, item]));
  return [...unique.values()].slice(0, 8);
}

export async function retrieveCommerceRagKnowledge(question: string): Promise<KnowledgeEntry[]> {
  if (!enabled() || !mongoUri()) return [];
  let retrieved: KnowledgeEntry[] = [];
  const productQuery = expandCommerceProductQuery(question);
  try {
    const discoverySlugs = discoveryProductSlugs(question);
    for (const slug of discoverySlugs) retrieved.push(...await exactProductResults(slug, question));
    const explicitlyNamed = await explicitlyReferencedProduct(question);
    if (explicitlyNamed && !explicitlyNamed.eligible) return [];
    retrieved.push(...(explicitlyNamed
      ? await exactProductResults(explicitlyNamed.slug, question)
      : await vectorResults(productQuery, "product")));
    // Bot Flow text additions are stored as verified platform knowledge. Search
    // that collection on every commerce turn so custom FAQs can answer arbitrary
    // customer wording, not only questions that explicitly mention Muditam.
    retrieved.push(...await vectorResults(question, "platform"));
  } catch (error) {
    console.warn(JSON.stringify({
      service: "muditam-ai-platform",
      event: "commerce_rag.vector_search_fallback",
      error: error instanceof Error ? error.message : String(error),
    }));
    try {
      retrieved.push(...await lexicalResults(productQuery, "product"));
      retrieved.push(...await lexicalResults(question, "platform"));
    } catch (fallbackError) {
      console.error(JSON.stringify({
        service: "muditam-ai-platform",
        event: "commerce_rag.retrieval_failed",
        error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
      }));
    }
  }
  return [...new Map(retrieved.map((entry) => [entry.key, entry])).values()].slice(0, 10);
}

export const ragConfig = { embeddingDimensions, embeddingModel };
