import { MongoClient, type Document } from "mongodb";
import OpenAI from "openai";
import { fuzzyIntent } from "../internal/fuzzy-match.js";
import type { KnowledgeEntry } from "./knowledge.js";

const PRODUCT_INTENT = /\b(product|products|supplement|supplements|ingredient|ingredients|price|buy|purchase|fizz|defend|fix|fuel|essentials|dense|snooze|shilajit|berberine|karela|jamun|ras|vati|gut|liver|heart|thyroid|nerve|bone|sleep)\b|(प्रोडक्ट|उत्पाद|सप्लीमेंट|सामग्री|कीमत|खरीद|शिलाजीत|करेला|जामुन|लिवर|हार्ट|थायराइड|नींद)/iu;
const PLATFORM_INTENT = /\b(muditam|company|platform|app|service|services|dietitian|dietician|doctor support|expert|consultation|upload(?:ed|ing)? (?:a )?report|report upload|analy[sz](?:e|ed|ing|is) (?:my |a |the )?report|how (?:does|do) (?:the )?report|ocr|multiple (?:report )?photos)\b|(मुदितम|कंपनी|प्लेटफॉर्म|एप|सेवा|डाइटिशियन|डायटीशियन|डॉक्टर|विशेषज्ञ|परामर्श|रिपोर्ट अपलोड|रिपोर्ट एनालिसिस|रिपोर्ट कैसे)/iu;
const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_DIMENSIONS = 1024;
const PRODUCT_CATALOGUE_PATTERN = /\b(?:what (?:are|products? (?:do|does)) muditam products?|what products? do (?:you|muditam) (?:have|offer|sell)|show (?:me )?(?:all |your )?products?|all (?:muditam )?products?|(?:your|muditam) product (?:catalogue|catalog))\b/iu;

function productCatalogueIntent(message: string): boolean {
  if (PRODUCT_CATALOGUE_PATTERN.test(message)) return true;
  const hasProduct = fuzzyIntent(message, ["product", "products", "catalogue", "catalog"]);
  const hasCatalogueRequest = fuzzyIntent(message, ["what", "show", "list", "all", "catalogue", "catalog"]);
  const identifiesMuditamCatalogue = fuzzyIntent(message, ["muditam"]) || /\b(?:your|aapke|apke)\b/iu.test(message);
  return hasProduct && hasCatalogueRequest && identifiesMuditamCatalogue;
}

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
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    mongoClient ??= new MongoClient(uri, { maxPoolSize: 5, minPoolSize: 0, serverSelectionTimeoutMS: 5_000 });
    try {
      await mongoClient.connect();
      return mongoClient.db(process.env.MUDITAM_KNOWLEDGE_DB || undefined);
    } catch (error) {
      lastError = error;
      await mongoClient.close().catch(() => {});
      mongoClient = null;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 150));
    }
  }
  throw lastError;
}

async function resetMongoConnection(): Promise<void> {
  await mongoClient?.close().catch(() => {});
  mongoClient = null;
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
  const channels = Array.isArray(item.channels)
    ? item.channels.filter((value): value is "mobile_app" | "shopify_web" => value === "mobile_app" || value === "shopify_web")
    : [];
  const audiences = Array.isArray(item.audiences)
    ? item.audiences.filter((value): value is "anonymous_visitor" | "verified_customer" => value === "anonymous_visitor" || value === "verified_customer")
    : [];
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
    ...(item.recommendationPriority === "hidden" || item.recommendationPriority === "boosted" || item.recommendationPriority === "normal"
      ? { recommendationPriority: item.recommendationPriority }
      : {}),
    ...(item.recommendationConcern === "blood_sugar" || item.recommendationConcern === "liver" || item.recommendationConcern === "heart"
      ? { recommendationConcern: item.recommendationConcern }
      : {}),
    ...(channels.length ? { channels } : {}),
    ...(audiences.length ? { audiences } : {}),
  };
}

export function knowledgeAllowedForContext(
  entry: KnowledgeEntry,
  channel: "mobile_app" | "shopify_web",
  audience: "anonymous_visitor" | "verified_customer",
): boolean {
  const channelAllowed = !entry.channels?.length || entry.channels.includes(channel);
  const audienceAllowed = !entry.audiences?.length || entry.audiences.includes(audience);
  return channelAllowed && audienceAllowed;
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
    expansions.push("liver wellness support liver fix liver defend");
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

function forcedProductSlugs(question: string): string[] {
  const latest = latestCustomerMessage(question);
  // Checked before the general product-intent gate below since "what's your best
  // seller" doesn't contain any of those words, but still needs to force-fetch the
  // bestseller product's knowledge so the deterministic bestseller guardrail has it.
  if (bestSellerPattern.test(latest)) return ["karela-jamun-fizz"];
  return [];
}

const discoveryConcerns = [
  { key: "blood_sugar" as const, pattern: /\b(?:diabetes|diabetic|blood sugar|glucose|sugar patient)\b|(?:डायबिटीज|मधुमेह|ब्लड शुगर)/iu, tags: ["diabetes", "blood-sugar", "blood sugar", "glucose", "metabolic"] },
  { key: "liver" as const, pattern: /\b(?:fatty liver|liver|lever)\b|(?:लिवर|जिगर)/iu, tags: ["liver", "fatty-liver", "fatty liver"] },
  { key: "heart" as const, pattern: /\b(?:heart|cardiac|cardiovascular)\b|(?:हार्ट|दिल)/iu, tags: ["heart", "cardiac", "cardiovascular"] },
] as const;

async function concernProductResults(question: string): Promise<KnowledgeEntry[]> {
  const latest = latestCustomerMessage(question);
  const asksForProduct = fuzzyIntent(latest, ["product", "products", "supplement", "something", "anything", "recommend"])
    || /\b(?:kuch|chahiye)\b|(?:प्रोडक्ट|उत्पाद|सप्लीमेंट|कुछ)/iu.test(latest);
  const concern = asksForProduct ? discoveryConcerns.find((item) => item.pattern.test(latest)) : undefined;
  if (!concern) return [];
  const db = await database();
  if (!db) return [];
  const products = await db.collection("metabolic_products").find({
    active: true,
    websiteStatus: "active",
    recommendationEligible: true,
    $or: [
      { category: concern.key },
      { chatbotTags: { $in: [...concern.tags] } },
    ],
  }, { projection: { slug: 1, name: 1, recommendationPriority: 1 } }).toArray();
  products.sort((left, right) => {
    const priority = Number(right.recommendationPriority === "boosted") - Number(left.recommendationPriority === "boosted");
    return priority || String(left.name).localeCompare(String(right.name));
  });
  const entries: KnowledgeEntry[] = [];
  for (const product of products.slice(0, 8)) {
    const entry = (await exactProductResults(String(product.slug), question))[0];
    if (entry) entries.push({
      ...entry,
      recommendationConcern: concern.key,
      recommendationPriority: product.recommendationPriority === "boosted" ? "boosted" : "normal",
    });
  }
  return entries;
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

function productReferenceNames(value: string): string[] {
  const full = normalizedProductName(value);
  const withoutMerchandisingSuffix = full.replace(/\b(?:pro|fizz)\b/gu, " ").replace(/\s+/gu, " ").trim();
  const knownAliases = full === "karela jamun fizz" ? ["karela jamun", "karela fizz"] : [];
  return [...new Set([full, withoutMerchandisingSuffix, ...knownAliases])].filter((name) => name.split(" ").length >= 2);
}

export async function explicitlyReferencedProduct(question: string): Promise<{ slug: string; eligible: boolean } | null> {
  if (!enabled() || !mongoUri() || !PRODUCT_INTENT.test(question)) return null;
  const db = await database();
  if (!db) return null;
  const normalizedQuestion = ` ${normalizedProductName(question)} `;
  const products = await db.collection("metabolic_products").find({}, {
    projection: { name: 1, slug: 1, active: 1, recommendationEligible: 1, websiteStatus: 1, chatbotAliases: 1 },
  }).toArray();
  const candidates = products
    .flatMap((product) => [
      ...productReferenceNames(String(product.name)),
      ...(Array.isArray(product.chatbotAliases) ? product.chatbotAliases.map((alias: unknown) => normalizedProductName(String(alias))) : []),
    ].map((name) => ({ product, name })))
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
  const entries = rows
    .map((row) => ({
      row,
      score: terms.reduce((score, term) => score + (String(row.title).toLowerCase().includes(term) ? 3 : 0) + (String(row.content).toLowerCase().includes(term) ? 1 : 0), 0),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 6)
    .map(({ row }) => toKnowledgeEntry(row));
  const product = await db.collection("metabolic_products").findOne({
    slug: productSlug,
    active: true,
    recommendationEligible: true,
    websiteStatus: "active",
  }, { projection: {
    name: 1,
    slug: 1,
    productUrl: 1,
    "websiteCatalog.sourceUrl": 1,
    "websiteCatalog.contentHash": 1,
    "websiteCatalog.publishedDosage": 1,
    "websiteCatalog.variants": 1,
    chatbotDescription: 1,
    chatbotFields: 1,
    recommendationPriority: 1,
  } });
  const publishedDosage = String(product?.websiteCatalog?.publishedDosage || "").trim();
  if (product) {
    const variants: Array<{ title: string; price: number; compareAtPrice: number | null; available: boolean }> = Array.isArray(product.websiteCatalog?.variants)
      ? product.websiteCatalog.variants.map((variant: Document) => ({
        title: String(variant.title || ""),
        price: Number(variant.price),
        compareAtPrice: variant.compareAtPrice == null ? null : Number(variant.compareAtPrice),
        available: variant.available === true,
      }))
      : [];
    entries.unshift(toKnowledgeEntry({
      key: `product:${productSlug}:live-shopify-details`,
      title: `${String(product.name)} — live Shopify details`,
      content: [
        `Product: ${String(product.name)}`,
        product.chatbotDescription && `Approved description: ${String(product.chatbotDescription)}`,
        product.chatbotFields?.concern && `Approved concerns: ${String(product.chatbotFields.concern)}`,
        product.chatbotFields?.keyBenefits && `Approved key benefits: ${String(product.chatbotFields.keyBenefits)}`,
        product.chatbotFields?.quantity && `Approved quantity: ${String(product.chatbotFields.quantity)}`,
        product.chatbotFields?.usage && `Approved usage: ${String(product.chatbotFields.usage)}`,
        product.chatbotFields?.warning && `Approved warning/disclaimer: ${String(product.chatbotFields.warning)}`,
        product.chatbotFields?.other && `Other approved product information: ${String(product.chatbotFields.other)}`,
        product.chatbotFields?.variantFormats && `Approved variant formats: ${String(product.chatbotFields.variantFormats)}`,
        publishedDosage && `Published dosage: ${publishedDosage}`,
        variants.length && `Shopify variants: ${variants.map((variant) => JSON.stringify(variant)).join(" | ")}`,
        "Shelf life: 18 months.",
      ].filter(Boolean).join("\n"),
      sourceName: "Muditam Ayurveda",
      sourceUrl: String(product.productUrl || product.websiteCatalog?.sourceUrl || ""),
      version: String(product.websiteCatalog?.contentHash || "live-catalogue"),
      sourceType: "product",
      productSlug,
      recommendationEligible: true,
      recommendationPriority: product.recommendationPriority === "boosted" ? "boosted" : "normal",
      channels: ["mobile_app", "shopify_web"],
      audiences: ["anonymous_visitor", "verified_customer"],
    }));
  }
  return entries.map((entry) => ({
    ...entry,
    recommendationPriority: product?.recommendationPriority === "boosted" ? "boosted" : "normal",
  }));
}

async function catalogueProductResults(): Promise<KnowledgeEntry[]> {
  const db = await database();
  if (!db) return [];
  const products = await db.collection("metabolic_products").find({
    active: true,
    websiteStatus: "active",
    recommendationEligible: true,
  }, { projection: { slug: 1, recommendationPriority: 1, chatbotDescription: 1, chatbotFields: 1 } }).sort({ recommendationPriority: 1, name: 1 }).toArray();
  const slugs = products.map((product) => String(product.slug)).filter(Boolean);
  const rows = await db.collection("knowledge_chunks").find({
    productSlug: { $in: slugs },
    sourceType: "product",
    active: true,
    recommendationEligible: true,
  }, { projection: { embedding: 0 } }).sort({ key: 1 }).toArray();
  const bySlug = new Map<string, Document>();
  for (const row of rows) {
    const slug = String(row.productSlug);
    const existing = bySlug.get(slug);
    if (!existing || /:overview$/u.test(String(row.key))) bySlug.set(slug, row);
  }
  const boostedSlugs = products.filter((product) => product.recommendationPriority === "boosted").map((product) => String(product.slug));
  const orderedSlugs = [...new Set([...boostedSlugs, "karela-jamun-fizz", ...slugs])];
  return orderedSlugs.flatMap((slug) => {
    const row = bySlug.get(slug);
    if (!row) return [];
    const product = products.find((item) => String(item.slug) === slug);
    const override = [
      product?.chatbotDescription && `Approved description: ${String(product.chatbotDescription)}`,
      product?.chatbotFields?.concern && `Approved concerns: ${String(product.chatbotFields.concern)}`,
      product?.chatbotFields?.keyBenefits && `Approved key benefits: ${String(product.chatbotFields.keyBenefits)}`,
      product?.chatbotFields?.quantity && `Approved quantity: ${String(product.chatbotFields.quantity)}`,
      product?.chatbotFields?.usage && `Approved usage: ${String(product.chatbotFields.usage)}`,
      product?.chatbotFields?.warning && `Approved warning/disclaimer: ${String(product.chatbotFields.warning)}`,
      product?.chatbotFields?.other && `Other approved product information: ${String(product.chatbotFields.other)}`,
      product?.chatbotFields?.variantFormats && `Approved variant formats: ${String(product.chatbotFields.variantFormats)}`,
    ].filter(Boolean).join("\n");
    const entry = toKnowledgeEntry(row);
    return [{ ...entry, content: override ? `${entry.content}\n${override}` : entry.content }];
  });
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
  context: { channel: "mobile_app" | "shopify_web"; audience: "anonymous_visitor" | "verified_customer" } = {
    channel: "mobile_app",
    audience: "verified_customer",
  },
): Promise<KnowledgeEntry[]> {
  const wantsProducts = PRODUCT_INTENT.test(question);
  const wantsPlatform = PLATFORM_INTENT.test(question);
  const allowedCurated = curated.filter((entry) => knowledgeAllowedForContext(entry, context.channel, context.audience));
  if (!enabled() || !mongoUri() || (!wantsProducts && !wantsPlatform)) return allowedCurated;
  let retrieved: KnowledgeEntry[] = [];
  try {
    if (wantsProducts) {
      retrieved.push(...await concernProductResults(question));
      for (const slug of forcedProductSlugs(question)) {
        retrieved.push(...await exactProductResults(slug, question));
      }
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
  const unique = new Map([...allowedCurated, ...retrieved]
    .filter((entry) => knowledgeAllowedForContext(entry, context.channel, context.audience))
    .map((item) => [item.key, item]));
  return [...unique.values()].slice(0, 8);
}

export async function retrieveCommerceRagKnowledge(question: string): Promise<KnowledgeEntry[]> {
  if (!enabled() || !mongoUri()) return [];
  if (productCatalogueIntent(question)) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return (await catalogueProductResults())
          .filter((entry) => knowledgeAllowedForContext(entry, "shopify_web", "anonymous_visitor"));
      } catch (error) {
        await resetMongoConnection();
        if (attempt === 3) {
          console.error(JSON.stringify({
            service: "muditam-ai-platform",
            event: "commerce_catalogue.retrieval_failed",
            error: error instanceof Error ? error.message : String(error),
          }));
        } else {
          await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
        }
      }
    }
    return [];
  }
  let retrieved: KnowledgeEntry[] = [];
  const productQuery = expandCommerceProductQuery(question);
  const forcedSlugs = forcedProductSlugs(question);
  try {
    retrieved.push(...await concernProductResults(question));
    for (const slug of forcedSlugs) retrieved.push(...await exactProductResults(slug, question));
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
    await resetMongoConnection();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        retrieved.push(...await concernProductResults(question));
        for (const slug of forcedSlugs) retrieved.push(...await exactProductResults(slug, question));
        retrieved.push(...await lexicalResults(productQuery, "product"));
        retrieved.push(...await lexicalResults(question, "platform"));
        break;
      } catch (fallbackError) {
        await resetMongoConnection();
        if (attempt === 3) {
          console.error(JSON.stringify({
            service: "muditam-ai-platform",
            event: "commerce_rag.retrieval_failed",
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          }));
        } else {
          await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
        }
      }
    }
  }
  return [...new Map(retrieved
    .filter((entry) => knowledgeAllowedForContext(entry, "shopify_web", "anonymous_visitor"))
    .map((entry) => [entry.key, entry])).values()].slice(0, 10);
}

export const ragConfig = { embeddingDimensions, embeddingModel };
