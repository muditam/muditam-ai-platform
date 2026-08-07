import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import process from "node:process";
import Busboy from "busboy";
import { ZodError } from "zod";
import { answerChat } from "./chat/chat-engine.js";
import { answerCommerceChat } from "./commerce/commerce-engine.js";
import { commerceChatRequestSchema } from "./commerce/contracts.js";
import {
  recordFeedback,
  recordMessageTurn,
  recordWidgetEvent,
} from "./commerce/analytics-store.js";
import {
  bearerToken,
  createStorefrontSession,
  verifyStorefrontSession,
} from "./commerce/storefront-session.js";
import {
  allowedStorefrontOrigin,
  StorefrontRateLimiter,
  storefrontClientKey,
} from "./commerce/storefront-policy.js";
import {
  directProcessingAllowed,
  isProduction,
  reviewUiAllowed,
} from "./server/access-policy.js";
import {
  assertAllowedSignedUrl,
  internalExtractionRequestSchema,
  validServiceSecret,
  type InternalExtractionRequest,
} from "./internal/extraction-request.js";
import {
  ExtractionError,
  extractImageReport,
  extractPdf,
  MAX_IMAGE_BATCH_PAGES,
  MAX_IMAGE_PAGE_BYTES,
  mergeStructuredReports,
  normalizeReport,
  OpenAIImageObservationExtractor,
  processImageBatch,
  renderPdfPages,
  structureReport,
  type ImageBatchPage,
  type SupportedImageMimeType,
} from "./index.js";

const HOST = isProduction()
  ? "0.0.0.0"
  : process.env.MUDITAM_REVIEW_HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? process.env.MUDITAM_REVIEW_PORT ?? 4173);
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BATCH_BYTES =
  MAX_IMAGE_BATCH_PAGES * MAX_IMAGE_PAGE_BYTES;
const MAX_VISION_PAGES = 10;
const VISION_CONCURRENCY = 2;
const MAX_INTERNAL_JSON_BYTES = 64 * 1024;
const MAX_CHAT_JSON_BYTES = 256 * 1024;
const htmlPath = resolve("local-test-ui/index.html");
const storefrontSessionLimiter = new StorefrontRateLimiter(10, 60_000);
const storefrontMessageLimiter = new StorefrontRateLimiter(20, 60_000);

function logEvent(
  event: string,
  fields: Record<string, unknown> = {},
): void {
  console.info(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      service: "muditam-report-extractor",
      event,
      ...fields,
    }),
  );
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(values.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = {
          status: "fulfilled",
          value: await operation(values[index] as T),
        };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, values.length) },
      () => worker(),
    ),
  );
  return results;
}

function json(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
  if (!isProduction()) {
    headers["Access-Control-Allow-Origin"] = "*";
    headers["Access-Control-Allow-Headers"] = "Content-Type, X-File-Name";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
  }
  response.writeHead(status, headers);
  response.end(JSON.stringify(body));
}

function storefrontJson(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  const origin = allowedStorefrontOrigin(typeof request.headers.origin === "string" ? request.headers.origin : undefined);
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    Vary: "Origin",
    ...extraHeaders,
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  }
  response.writeHead(status, headers);
  response.end(JSON.stringify(body));
}

async function readRequest(
  request: IncomingMessage,
): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BYTES) {
      throw new ExtractionError(
        "FILE_TOO_LARGE",
        `PDF exceeds the ${MAX_BYTES} byte local review limit.`,
      );
    }
    chunks.push(buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

async function readInternalJson(
  request: IncomingMessage,
): Promise<InternalExtractionRequest> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_INTERNAL_JSON_BYTES) {
      throw new ExtractionError("FILE_TOO_LARGE", "Internal request is too large.");
    }
    chunks.push(buffer);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ExtractionError("INVALID_CONFIGURATION", "Invalid internal request JSON.");
  }
  const parsed = internalExtractionRequestSchema.safeParse(value);
  if (!parsed.success) {
    throw new ExtractionError("INVALID_CONFIGURATION", "Invalid internal extraction request.");
  }
  parsed.data.files.forEach((file) => assertAllowedSignedUrl(file.url));
  return parsed.data;
}

async function readJson(request: IncomingMessage, maximumBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumBytes) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function downloadSignedFile(
  file: InternalExtractionRequest["files"][number],
): Promise<Uint8Array> {
  const response = await fetch(file.url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new ExtractionError(
      "INVALID_CONFIGURATION",
      `Could not download stored report file (${response.status}).`,
    );
  }
  const declaredBytes = Number(response.headers.get("content-length") ?? 0);
  if (declaredBytes > MAX_BYTES) {
    throw new ExtractionError("FILE_TOO_LARGE", "Stored report file is too large.");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
    throw new ExtractionError("FILE_TOO_LARGE", "Stored report file is empty or too large.");
  }
  return bytes;
}

async function processStoredFiles(
  payload: InternalExtractionRequest,
): Promise<{ status: number; body: unknown }> {
  const ordered = [...payload.files].sort((left, right) => left.order - right.order);
  const downloaded = await Promise.all(
    ordered.map(async (file) => ({ file, bytes: await downloadSignedFile(file) })),
  );
  const totalBytes = downloaded.reduce((total, item) => total + item.bytes.byteLength, 0);
  if (totalBytes > MAX_IMAGE_BATCH_BYTES) {
    throw new ExtractionError("FILE_TOO_LARGE", "Stored report batch is too large.");
  }

  let processingResponse: Response;
  if (downloaded.length === 1) {
    const item = downloaded[0] as (typeof downloaded)[number];
    processingResponse = await fetch(`http://127.0.0.1:${PORT}/api/process`, {
      method: "POST",
      headers: {
        "Content-Type": item.file.mimeType,
        "X-File-Name": encodeURIComponent(item.file.originalName),
      },
      body: Buffer.from(item.bytes),
    });
  } else {
    if (downloaded.some((item) => !["image/jpeg", "image/png"].includes(item.file.mimeType))) {
      throw new ExtractionError(
        "INVALID_CONFIGURATION",
        "Multiple stored report files must all be JPG or PNG images.",
      );
    }
    const form = new FormData();
    downloaded.forEach((item) => {
      const blobBytes = Uint8Array.from(item.bytes);
      form.append(
        "pages",
        new Blob([blobBytes.buffer], { type: item.file.mimeType }),
        item.file.originalName,
      );
    });
    processingResponse = await fetch(`http://127.0.0.1:${PORT}/api/process-images`, {
      method: "POST",
      body: form,
    });
  }
  const text = await processingResponse.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new ExtractionError("INVALID_CONFIGURATION", "Extraction returned invalid JSON.");
  }
  return { status: processingResponse.status, body };
}

async function readImageBatch(
  request: IncomingMessage,
): Promise<ImageBatchPage[]> {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new ExtractionError(
      "INVALID_IMAGE",
      "Multiple report photos must use multipart/form-data.",
    );
  }
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (declaredLength > MAX_IMAGE_BATCH_BYTES) {
    throw new ExtractionError(
      "FILE_TOO_LARGE",
      "The combined report-photo upload is too large.",
    );
  }

  return new Promise((resolveBatch, rejectBatch) => {
    let settled = false;
    const rejectOnce = (error: unknown): void => {
      if (settled) return;
      settled = true;
      rejectBatch(error);
    };
    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({
        headers: request.headers,
        limits: {
          files: MAX_IMAGE_BATCH_PAGES,
          fileSize: MAX_IMAGE_PAGE_BYTES,
          fields: 0,
          parts: MAX_IMAGE_BATCH_PAGES,
        },
      });
    } catch {
      rejectOnce(
        new ExtractionError("INVALID_IMAGE", "Invalid multipart upload."),
      );
      return;
    }
    const pages: Array<ImageBatchPage & { index: number }> = [];
    let nextIndex = 0;
    let totalBytes = 0;
    parser.on("file", (_field, stream, info) => {
      const index = nextIndex++;
      const mimeType = info.mimeType.toLowerCase();
      if (mimeType !== "image/png" && mimeType !== "image/jpeg") {
        stream.resume();
        rejectOnce(
          new ExtractionError(
            "INVALID_IMAGE",
            "Every item in a multi-photo upload must be PNG or JPEG.",
          ),
        );
        return;
      }
      const chunks: Buffer[] = [];
      let fileBytes = 0;
      stream.on("data", (chunk: Buffer) => {
        fileBytes += chunk.length;
        totalBytes += chunk.length;
        if (totalBytes > MAX_IMAGE_BATCH_BYTES) {
          rejectOnce(
            new ExtractionError(
              "FILE_TOO_LARGE",
              "The combined report-photo upload is too large.",
            ),
          );
          return;
        }
        chunks.push(chunk);
      });
      stream.on("limit", () => {
        rejectOnce(
          new ExtractionError(
            "FILE_TOO_LARGE",
            `${info.filename || `Photo ${index + 1}`} exceeds the 10 MB limit.`,
          ),
        );
      });
      stream.on("end", () => {
        if (fileBytes === 0) {
          rejectOnce(
            new ExtractionError("INVALID_IMAGE", "An uploaded photo was empty."),
          );
          return;
        }
        pages.push({
          index,
          bytes: new Uint8Array(Buffer.concat(chunks)),
          fileName: info.filename || `report-page-${index + 1}`,
          mimeType: mimeType as SupportedImageMimeType,
        });
      });
    });
    parser.on("filesLimit", () => {
      rejectOnce(
        new ExtractionError(
          "INVALID_IMAGE",
          `Upload no more than ${MAX_IMAGE_BATCH_PAGES} report photos.`,
        ),
      );
    });
    parser.on("error", () => {
      rejectOnce(
        new ExtractionError("INVALID_IMAGE", "Could not read the photo upload."),
      );
    });
    parser.on("close", () => {
      if (settled) return;
      if (pages.length === 0) {
        rejectOnce(
          new ExtractionError("INVALID_IMAGE", "No report photos were uploaded."),
        );
        return;
      }
      settled = true;
      resolveBatch(
        pages
          .sort((left, right) => left.index - right.index)
          .map(({ index: _index, ...page }) => page),
      );
    });
    request.pipe(parser);
  });
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  requestId: string,
): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
  const isStorefrontCommerceRoute = url.pathname.startsWith("/api/v1/commerce/");
  if (request.method === "OPTIONS" && isStorefrontCommerceRoute) {
    const origin = allowedStorefrontOrigin(typeof request.headers.origin === "string" ? request.headers.origin : undefined);
    if (!origin) {
      json(response, 403, { error: "Storefront origin is not allowed.", code: "ORIGIN_NOT_ALLOWED" });
      return;
    }
    storefrontJson(request, response, 204, null);
    return;
  }
  if (request.method === "OPTIONS" && !isProduction()) {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, X-File-Name",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    });
    response.end();
    return;
  }
  if (
    request.method === "GET" &&
    url.pathname === "/" &&
    reviewUiAllowed()
  ) {
    const html = await readFile(htmlPath);
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(html);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    json(response, 200, { status: "ok" });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/commerce/sessions") {
    const origin = allowedStorefrontOrigin(typeof request.headers.origin === "string" ? request.headers.origin : undefined);
    if (!origin) {
      json(response, 403, { error: "Storefront origin is not allowed.", code: "ORIGIN_NOT_ALLOWED" });
      return;
    }
    if (String(process.env.MUDITAM_COMMERCE_CHAT_ENABLED ?? "false").toLowerCase() !== "true") {
      storefrontJson(request, response, 503, { error: "Commerce chat is temporarily disabled.", code: "COMMERCE_CHAT_DISABLED" });
      return;
    }
    const rate = storefrontSessionLimiter.allow(storefrontClientKey(request, "new-session"));
    if (!rate.allowed) {
      storefrontJson(request, response, 429, { error: "Too many session requests.", code: "RATE_LIMITED" }, {
        "Retry-After": String(rate.retryAfterSeconds),
      });
      return;
    }
    try {
      const session = createStorefrontSession();
      storefrontJson(request, response, 201, session);
    } catch (error) {
      logEvent("storefront_commerce_session.failed", { requestId });
      console.error(error);
      storefrontJson(request, response, 503, { error: "Commerce chat is not configured.", code: "COMMERCE_CHAT_CONFIGURATION_ERROR" });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/commerce/messages") {
    const origin = allowedStorefrontOrigin(typeof request.headers.origin === "string" ? request.headers.origin : undefined);
    if (!origin) {
      json(response, 403, { error: "Storefront origin is not allowed.", code: "ORIGIN_NOT_ALLOWED" });
      return;
    }
    if (String(process.env.MUDITAM_COMMERCE_CHAT_ENABLED ?? "false").toLowerCase() !== "true") {
      storefrontJson(request, response, 503, { error: "Commerce chat is temporarily disabled.", code: "COMMERCE_CHAT_DISABLED" });
      return;
    }
    let session;
    try {
      const token = bearerToken(request.headers.authorization);
      session = token ? verifyStorefrontSession(token) : null;
    } catch {
      storefrontJson(request, response, 503, { error: "Commerce chat is not configured.", code: "COMMERCE_CHAT_CONFIGURATION_ERROR" });
      return;
    }
    if (!session) {
      storefrontJson(request, response, 401, { error: "Invalid or expired storefront session.", code: "INVALID_STOREFRONT_SESSION" });
      return;
    }
    const rate = storefrontMessageLimiter.allow(storefrontClientKey(request, session.visitorId));
    if (!rate.allowed) {
      storefrontJson(request, response, 429, { error: "Please wait before sending another message.", code: "RATE_LIMITED" }, {
        "Retry-After": String(rate.retryAfterSeconds),
      });
      return;
    }
    const startedAt = Date.now();
    try {
      const payload = await readJson(request, MAX_CHAT_JSON_BYTES);
      const scopedPayload = typeof payload === "object" && payload !== null
        ? { ...payload, conversationId: session.conversationId, visitorId: session.visitorId, channel: "shopify_web" }
        : payload;
      const parsedInput = commerceChatRequestSchema.parse(scopedPayload);
      const result = await answerCommerceChat(parsedInput);
      void recordMessageTurn(parsedInput, result);
      logEvent("storefront_commerce_chat.completed", {
        requestId,
        visitorId: session.visitorId,
        conversationId: session.conversationId,
        durationMs: Date.now() - startedAt,
        decision: result.decision,
        category: result.category,
        recommendationCount: result.recommendedProducts.length,
        handoffQueue: result.handoff?.queue ?? null,
        model: result.model,
        totalTokens: result.usage.totalTokens,
      });
      storefrontJson(request, response, 200, result);
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError || (error instanceof Error && error.message === "REQUEST_TOO_LARGE")) {
        storefrontJson(request, response, 400, { error: "Invalid commerce chat request.", code: "INVALID_COMMERCE_CHAT_REQUEST" });
        return;
      }
      logEvent("storefront_commerce_chat.failed", { requestId, durationMs: Date.now() - startedAt });
      console.error(error);
      storefrontJson(request, response, 502, { error: "The commerce assistant is temporarily unavailable.", code: "COMMERCE_CHAT_PROVIDER_ERROR" });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/commerce/events") {
    const origin = allowedStorefrontOrigin(typeof request.headers.origin === "string" ? request.headers.origin : undefined);
    if (!origin) {
      json(response, 403, { error: "Storefront origin is not allowed.", code: "ORIGIN_NOT_ALLOWED" });
      return;
    }
    let session;
    try {
      const token = bearerToken(request.headers.authorization);
      session = token ? verifyStorefrontSession(token) : null;
    } catch {
      storefrontJson(request, response, 503, { error: "Commerce chat is not configured.", code: "COMMERCE_CHAT_CONFIGURATION_ERROR" });
      return;
    }
    if (!session) {
      storefrontJson(request, response, 401, { error: "Invalid or expired storefront session.", code: "INVALID_STOREFRONT_SESSION" });
      return;
    }
    try {
      const payload = await readJson(request, MAX_CHAT_JSON_BYTES) as Record<string, unknown>;
      const type = typeof payload?.type === "string" ? payload.type : null;
      if (!type || type.length > 60) {
        storefrontJson(request, response, 400, { error: "Invalid event payload.", code: "INVALID_COMMERCE_EVENT" });
        return;
      }
      const productSlug = typeof payload.productSlug === "string" ? payload.productSlug : undefined;
      const eventUrl = typeof payload.url === "string" ? payload.url.slice(0, 2000) : undefined;
      void recordWidgetEvent({
        conversationId: session.conversationId,
        visitorId: session.visitorId,
        type,
        ...(productSlug !== undefined ? { productSlug } : {}),
        ...(eventUrl !== undefined ? { url: eventUrl } : {}),
      });
      storefrontJson(request, response, 202, { accepted: true });
    } catch (error) {
      if (error instanceof SyntaxError || (error instanceof Error && error.message === "REQUEST_TOO_LARGE")) {
        storefrontJson(request, response, 400, { error: "Invalid event payload.", code: "INVALID_COMMERCE_EVENT" });
        return;
      }
      console.error(error);
      storefrontJson(request, response, 202, { accepted: false });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/commerce/feedback") {
    const origin = allowedStorefrontOrigin(typeof request.headers.origin === "string" ? request.headers.origin : undefined);
    if (!origin) {
      json(response, 403, { error: "Storefront origin is not allowed.", code: "ORIGIN_NOT_ALLOWED" });
      return;
    }
    let session;
    try {
      const token = bearerToken(request.headers.authorization);
      session = token ? verifyStorefrontSession(token) : null;
    } catch {
      storefrontJson(request, response, 503, { error: "Commerce chat is not configured.", code: "COMMERCE_CHAT_CONFIGURATION_ERROR" });
      return;
    }
    if (!session) {
      storefrontJson(request, response, 401, { error: "Invalid or expired storefront session.", code: "INVALID_STOREFRONT_SESSION" });
      return;
    }
    try {
      const payload = await readJson(request, MAX_CHAT_JSON_BYTES) as Record<string, unknown>;
      const rating = payload?.rating;
      if (rating !== "up" && rating !== "down") {
        storefrontJson(request, response, 400, { error: "Invalid feedback payload.", code: "INVALID_COMMERCE_FEEDBACK" });
        return;
      }
      void recordFeedback(session.conversationId, rating);
      storefrontJson(request, response, 202, { accepted: true });
    } catch (error) {
      if (error instanceof SyntaxError || (error instanceof Error && error.message === "REQUEST_TOO_LARGE")) {
        storefrontJson(request, response, 400, { error: "Invalid feedback payload.", code: "INVALID_COMMERCE_FEEDBACK" });
        return;
      }
      console.error(error);
      storefrontJson(request, response, 202, { accepted: false });
    }
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/internal/report-extractions"
  ) {
    if (!validServiceSecret(request.headers["x-muditam-service-secret"] as string | undefined)) {
      json(response, 401, { error: "Unauthorized service request." });
      return;
    }
    const startedAt = Date.now();
    const payload = await readInternalJson(request);
    logEvent("internal_report.received", {
      requestId,
      reportId: payload.reportId,
      fileCount: payload.files.length,
    });
    const result = await processStoredFiles(payload);
    logEvent("internal_report.completed", {
      requestId,
      reportId: payload.reportId,
      durationMs: Date.now() - startedAt,
      upstreamStatus: result.status,
    });
    json(response, result.status, result.body);
    return;
  }

  if (request.method === "POST" && url.pathname === "/internal/ai-chat/messages") {
    if (!validServiceSecret(request.headers["x-muditam-service-secret"] as string | undefined)) {
      json(response, 401, { error: "Unauthorized service request." });
      return;
    }
    if (String(process.env.MUDITAM_CHAT_ENABLED ?? "true").toLowerCase() === "false") {
      json(response, 503, { error: "AI chat is temporarily disabled.", code: "CHAT_DISABLED" });
      return;
    }
    const startedAt = Date.now();
    try {
      const payload = await readJson(request, MAX_CHAT_JSON_BYTES);
      const result = await answerChat(payload);
      logEvent("internal_chat.completed", {
        requestId,
        durationMs: Date.now() - startedAt,
        decision: result.decision,
        category: result.category,
        citationCount: result.citations.length,
        guardrailStage: result.guardrailStage,
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
      });
      json(response, 200, result);
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError || (error instanceof Error && error.message === "REQUEST_TOO_LARGE")) {
        json(response, 400, { error: "Invalid chat request.", code: "INVALID_CHAT_REQUEST" });
        return;
      }
      logEvent("internal_chat.failed", { requestId, durationMs: Date.now() - startedAt });
      console.error(error);
      json(response, 502, { error: "The AI assistant is temporarily unavailable.", code: "CHAT_PROVIDER_ERROR" });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/internal/commerce-chat/messages") {
    if (!validServiceSecret(request.headers["x-muditam-service-secret"] as string | undefined)) {
      json(response, 401, { error: "Unauthorized service request." });
      return;
    }
    if (String(process.env.MUDITAM_COMMERCE_CHAT_ENABLED ?? "false").toLowerCase() !== "true") {
      json(response, 503, { error: "Commerce chat is temporarily disabled.", code: "COMMERCE_CHAT_DISABLED" });
      return;
    }
    const startedAt = Date.now();
    try {
      const payload = await readJson(request, MAX_CHAT_JSON_BYTES);
      const result = await answerCommerceChat(payload);
      logEvent("internal_commerce_chat.completed", {
        requestId,
        durationMs: Date.now() - startedAt,
        decision: result.decision,
        category: result.category,
        recommendationCount: result.recommendedProducts.length,
        knowledgeReferenceCount: result.knowledgeReferences.length,
        handoffQueue: result.handoff?.queue ?? null,
        guardrailStage: result.guardrailStage,
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
      });
      json(response, 200, result);
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError || (error instanceof Error && error.message === "REQUEST_TOO_LARGE")) {
        json(response, 400, { error: "Invalid commerce chat request.", code: "INVALID_COMMERCE_CHAT_REQUEST" });
        return;
      }
      logEvent("internal_commerce_chat.failed", { requestId, durationMs: Date.now() - startedAt });
      console.error(error);
      json(response, 502, { error: "The commerce assistant is temporarily unavailable.", code: "COMMERCE_CHAT_PROVIDER_ERROR" });
    }
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/process-images"
  ) {
    if (!directProcessingAllowed(process.env.NODE_ENV, request.socket.remoteAddress)) {
      json(response, 404, { error: "Not found." });
      return;
    }
    const startedAt = Date.now();
    const pages = await readImageBatch(request);
    const apiKey =
      process.env.MUDITAM_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new ExtractionError(
        "INVALID_CONFIGURATION",
        "Set MUDITAM_OPENAI_API_KEY to enable image report extraction.",
      );
    }
    logEvent("image_batch.received", {
      requestId,
      pageCount: pages.length,
      byteSize: pages.reduce(
        (total, page) => total + page.bytes.byteLength,
        0,
      ),
    });
    const result = await processImageBatch(
      pages,
      new OpenAIImageObservationExtractor({ apiKey }),
      (event, pageNumber, fields = {}) => {
        logEvent(`image_batch.page.${event}`, {
          requestId,
          pageNumber,
          ...fields,
        });
      },
    );
    const unreadable = result.structured.statistics.observationCount === 0;
    const partial = result.failedPages.length > 0 && !unreadable;
    const warnings = unreadable
      ? ["Couldn’t read your report. Please contact our dietitian."]
      : partial
        ? [
            "Some pages could not be read. Reliable extracted values are shown below.",
          ]
        : [];
    const normalized = normalizeReport(result.structured, {
      status: unreadable ? "UNREADABLE" : partial ? "PARTIAL" : "COMPLETE",
      totalPages: pages.length,
      pdfTextPages: [],
      visionPages: result.successfulPages,
      failedPages: result.failedPages,
      warnings,
    });
    logEvent("image_batch.completed", {
      requestId,
      durationMs: Date.now() - startedAt,
      processingStatus: normalized.processing.status,
      observationCount: normalized.statistics.observationCount,
      successfulPages: result.successfulPages,
      failedPages: result.failedPages,
    });
    json(response, 200, normalized);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/process") {
    if (!directProcessingAllowed(process.env.NODE_ENV, request.socket.remoteAddress)) {
      json(response, 404, { error: "Not found." });
      return;
    }
    const startedAt = Date.now();
    const contentType = request.headers["content-type"]?.split(";")[0]?.trim();
    const encodedName = request.headers["x-file-name"];
    const fileName =
      typeof encodedName === "string"
        ? decodeURIComponent(encodedName)
        : "uploaded-report";
    const bytes = await readRequest(request);
    logEvent("report.received", {
      requestId,
      mimeType: contentType ?? "unknown",
      byteSize: bytes.byteLength,
    });
    const imageTypes = new Set<SupportedImageMimeType>([
      "image/png",
      "image/jpeg",
    ]);
    if (imageTypes.has(contentType as SupportedImageMimeType)) {
      const apiKey =
        process.env.MUDITAM_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new ExtractionError(
          "INVALID_CONFIGURATION",
          "Set MUDITAM_OPENAI_API_KEY to enable image report extraction.",
        );
      }
      logEvent("vision.extraction.started", {
        requestId,
        provider: "openai",
        model:
          process.env.MUDITAM_OPENAI_VISION_MODEL ?? "gpt-5.6-luna",
      });
      const structured = await extractImageReport(
        {
          bytes,
          fileName,
          mimeType: contentType as SupportedImageMimeType,
        },
        new OpenAIImageObservationExtractor({ apiKey }),
      );
      const unreadable = structured.statistics.observationCount === 0;
      const normalized = normalizeReport(structured, {
        status: unreadable ? "UNREADABLE" : "COMPLETE",
        totalPages: 1,
        pdfTextPages: [],
        visionPages: unreadable ? [] : [1],
        failedPages: unreadable ? [1] : [],
        warnings: unreadable
          ? ["Couldn’t read your report. Please contact our dietitian."]
          : [],
      });
      logEvent("vision.extraction.completed", {
        requestId,
        durationMs: Date.now() - startedAt,
        observationCount: normalized.statistics.observationCount,
        autoAcceptedCount: normalized.statistics.autoAcceptedCount,
        userConfirmationCount: normalized.statistics.userConfirmationCount,
        reviewRequiredCount: normalized.statistics.reviewRequiredCount,
      });
      json(response, 200, normalized);
      return;
    }
    if (contentType !== "application/pdf") {
      json(response, 415, {
        error:
          "DOCX processing is not configured yet. Upload a PDF, PNG, or JPEG report.",
        code: "UNSUPPORTED_DOCUMENT_TYPE",
        receivedMimeType: contentType ?? null,
      });
      return;
    }
    logEvent("pdf.text_extraction.started", { requestId });
    const extracted = await extractPdf(bytes, { fileName });
    logEvent("pdf.text_extraction.completed", {
      requestId,
      pageCount: extracted.pages.length,
      pagesExtracted: extracted.quality.pagesExtracted,
      pagesRequiringOcr: extracted.quality.pagesRequiringOcr,
      qualityStatus: extracted.quality.status,
    });
    const digitalStructured = structureReport(extracted);
    const ocrPages = extracted.quality.pagesRequiringOcr;
    const pdfTextPages = extracted.pages
      .filter(
        (page) =>
          page.quality.status === "GOOD" ||
          page.quality.status === "SUSPECT",
      )
      .map((page) => page.pageNumber);
    let visionReports: Awaited<ReturnType<typeof extractImageReport>>[] = [];
    let visionPages: number[] = [];
    let failedPages: number[] = [];
    const processingWarnings: string[] = [];

    if (ocrPages.length > 0) {
      const apiKey =
        process.env.MUDITAM_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new ExtractionError(
          "INVALID_CONFIGURATION",
          "Set MUDITAM_OPENAI_API_KEY to process scanned PDF pages.",
        );
      }
      const pagesToProcess = ocrPages.slice(0, MAX_VISION_PAGES);
      if (ocrPages.length > MAX_VISION_PAGES) {
        const skipped = ocrPages.slice(MAX_VISION_PAGES);
        failedPages.push(...skipped);
        processingWarnings.push(
          `${skipped.length} scanned pages exceeded the ${MAX_VISION_PAGES}-page vision limit.`,
        );
      }
      logEvent("pdf.vision_render.started", {
        requestId,
        pages: pagesToProcess,
      });
      const renderedPages = await renderPdfPages(bytes, pagesToProcess);
      logEvent("pdf.vision_render.completed", {
        requestId,
        pageCount: renderedPages.length,
      });
      const extractor = new OpenAIImageObservationExtractor({ apiKey });
      const pageResults = await mapWithConcurrency(
        renderedPages,
        VISION_CONCURRENCY,
        async (page) => {
          logEvent("pdf.vision_page.started", {
            requestId,
            pageNumber: page.pageNumber,
          });
          let lastError: unknown;
          for (let attempt = 1; attempt <= 2; attempt += 1) {
            try {
              const report = await extractImageReport(
                {
                  bytes: page.pngBytes,
                  fileName: `report-page-${page.pageNumber}.png`,
                  mimeType: "image/png",
                  sourcePageNumber: page.pageNumber,
                },
                extractor,
              );
              logEvent("pdf.vision_page.completed", {
                requestId,
                pageNumber: page.pageNumber,
                attempt,
                observationCount: report.statistics.observationCount,
              });
              return { pageNumber: page.pageNumber, report };
            } catch (error) {
              lastError = error;
              if (
                !(error instanceof ExtractionError) ||
                error.code !== "VISION_PROVIDER_ERROR" ||
                attempt === 2
              ) {
                throw error;
              }
              logEvent("pdf.vision_page.retrying", {
                requestId,
                pageNumber: page.pageNumber,
                attempt,
              });
            }
          }
          throw lastError;
        },
      );
      pageResults.forEach((result, index) => {
        const pageNumber = renderedPages[index]?.pageNumber;
        if (pageNumber === undefined) return;
        if (result.status === "rejected") {
          failedPages.push(pageNumber);
          processingWarnings.push(`Page ${pageNumber} could not be read.`);
          return;
        }
        visionReports.push(result.value.report);
        if (result.value.report.statistics.observationCount > 0) {
          visionPages.push(pageNumber);
        } else {
          failedPages.push(pageNumber);
          processingWarnings.push(`Page ${pageNumber} could not be read.`);
        }
      });
    }

    const structured = mergeStructuredReports(
      digitalStructured,
      visionReports,
    );
    const unreadable = structured.statistics.observationCount === 0;
    const partial = failedPages.length > 0;
    if (unreadable) {
      processingWarnings.unshift(
        "Couldn’t read your report. Please contact our dietitian.",
      );
    } else if (partial) {
      processingWarnings.unshift(
        "Some pages could not be read. Reliable extracted values are shown below.",
      );
    }
    const normalized = normalizeReport(structured, {
      status: unreadable ? "UNREADABLE" : partial ? "PARTIAL" : "COMPLETE",
      totalPages: extracted.pages.length,
      pdfTextPages,
      visionPages,
      failedPages: [...new Set(failedPages)].sort((a, b) => a - b),
      warnings: processingWarnings,
    });
    logEvent("report.normalization.completed", {
      requestId,
      durationMs: Date.now() - startedAt,
      observationCount: normalized.statistics.observationCount,
      autoAcceptedCount: normalized.statistics.autoAcceptedCount,
      userConfirmationCount: normalized.statistics.userConfirmationCount,
      reviewRequiredCount: normalized.statistics.reviewRequiredCount,
    });
    json(response, 200, normalized);
    return;
  }

  json(response, 404, { error: "Not found." });
}

const server = createServer((request, response) => {
  const requestId = randomUUID();
  response.setHeader("X-Request-Id", requestId);
  handle(request, response, requestId).catch((error: unknown) => {
    if (error instanceof ExtractionError) {
      const status =
        error.code === "INVALID_CONFIGURATION"
          ? 503
          : error.code === "VISION_PROVIDER_ERROR"
            ? 502
            : 400;
      logEvent("report.processing.failed", {
        requestId,
        code: error.code,
      });
      json(response, status, { error: error.message, code: error.code });
      return;
    }
    logEvent("report.processing.failed", {
      requestId,
      code: "UNEXPECTED_ERROR",
    });
    console.error(error);
    json(response, 500, { error: "Could not process this report." });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Muditam report reviewer: http://${HOST}:${PORT}`);
  console.log("Press Ctrl+C to stop.");
});
