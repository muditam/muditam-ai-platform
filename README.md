# Muditam AI Platform

Blood-report extraction and normalization service used by the Muditam mobile
application.

The current implementation handles digital PDFs, scanned PDFs, mixed PDFs,
PNG images, and JPEG images. It extracts printed laboratory observations and
maps them to a versioned biomarker catalogue. It does not diagnose a patient,
invent missing results, or generate estimated dashboard values.

DOCX extraction, clinical interpretation, and voice are not included in this
milestone. The service also contains two isolated AI chat paths: the existing
authenticated health/report assistant and an authenticated commerce-chat
foundation for product discovery, product cards, support, and expert handoff.

In production, only `GET /api/health` and the service-authenticated
`POST /internal/report-extractions` integration are externally available. The
local reviewer UI, `POST /api/process`, and `POST /api/process-images` are
development tools and return `404` to external production requests. Internal
loopback calls remain available so the authenticated integration can reuse the
same extraction pipeline.

## Current architecture

```text
PDF upload
  |
  v
Validate signature, byte size, and page count
  |
  v
PDF.js inspects every page
  |
  +-------------------------+--------------------------+
  | Readable digital page   | OCR-required page        |
  | Extract text and layout | Render page to PNG       |
  +-------------------------+--------------------------+
                                      |
                                      v
                               OpenAI Vision
  |                                   |
  +-----------------+-----------------+
                    v
       Merge raw observations by source page
                    |
                    v
       Canonical mapping and field validation
                    |
                    v
         One normalized JSON API response
```

For direct PNG and JPEG uploads, the request starts at OpenAI Vision and then
enters the same canonical mapping and validation pipeline.

### App-backend integration

Production report processing is backend-owned. The app backend calls
`POST /internal/report-extractions` with an ordered list of short-lived private
Wasabi download URLs. This endpoint requires `X-Muditam-Service-Secret`; it is
not a mobile/public API. Download URLs must be HTTPS and hosted under
`wasabisys.com`, preventing the service from being used as a general URL
fetcher.

The internal endpoint downloads each original into memory within existing size
limits, reuses the same PDF/image extraction paths described below, and returns
one normalized report. Originals and signed URLs are never persisted by this
service.

The mobile app can also submit an ordered batch of up to 10 PNG/JPEG report
photos. Each photo is treated as one report page. Two photos are processed
concurrently, page order is retained in source provenance, and all successful
observations are merged before canonical mapping and duplicate validation.

### PDF page routing

PDF.js extracts positioned text fragments, reconstructs lines, preserves source
coordinates, and assesses each page:

- `GOOD`: meaningful embedded text was extracted.
- `SUSPECT`: text exists but requires more cautious validation.
- `OCR_REQUIRED`: image content exists without sufficient usable text.
- `EMPTY`: neither useful text nor image content was detected.

Only pages marked `OCR_REQUIRED` are rendered and sent to Vision. Mixed PDFs
therefore do not pay Vision costs for readable digital pages.

The service processes at most 10 Vision pages per PDF, with two page requests
running concurrently. A temporary provider error is retried once. Results from
successful pages remain available if another page fails.

### Vision extraction

OpenAI Vision is instructed to transcribe only visibly printed patient-result
rows. It returns raw test name, value, unit, reference range, laboratory flag,
method, evidence, and extraction confidence. It must not diagnose, calculate,
infer missing values, or choose canonical biomarker codes.

The OpenAI API key exists only in this server. Never expose it through an
`EXPO_PUBLIC_*` mobile variable.

`AI_PLATFORM_SERVICE_SECRET` must contain at least 32 characters and exactly
match the value configured in the app backend for that environment.

### Canonical mapping and validation

All PDF.js and Vision observations enter the same deterministic pipeline:

1. Parse values and reference ranges without changing the printed fact.
2. Resolve approved vendor aliases against the versioned biomarker catalogue.
3. Use conservative token-signature matching only when aliases do not match.
4. Check panel context and unit compatibility.
5. Detect conflicting duplicate values.
6. Preserve unmapped or uncertain observations for review.

HbA1c is unit-aware: NGSP `%` and IFCC `mmol/mol` representations are converted
and compared. Equivalent representations collapse to one preferred `%` result;
an IFCC-only result is normalized to `%`; inconsistent representations are
marked `REVIEW_REQUIRED` instead of being selected silently.

Each normalized observation contains:

- canonical biomarker identity when confidently resolved;
- raw and normalized values and units;
- source page and extraction method;
- independent mapping, layout, parsing, unit, and overall confidence;
- validation issues and evidence; and
- `AUTO_ACCEPT`, `USER_CONFIRMATION`, or `REVIEW_REQUIRED`.

The overall confidence is the lowest field-level confidence. It is an
extraction confidence, not a medical probability.

### Report processing result

The response includes a `processing` object:

```json
{
  "status": "COMPLETE",
  "totalPages": 3,
  "pdfTextPages": [1, 2],
  "visionPages": [3],
  "failedPages": [],
  "warnings": []
}
```

Possible processing statuses:

- `COMPLETE`: the report produced observations without page failures.
- `PARTIAL`: some pages failed; reliable values from successful pages remain.
- `UNREADABLE`: no reliable observations were extracted.

The mobile UI displays successful observations for `COMPLETE` and `PARTIAL`
reports. A partial report receives a red warning. An unreadable report receives
the red message `Couldn’t read your report. Please contact our dietitian.` and
keeps all dashboard metrics empty. Biomarkers genuinely absent from a readable
report remain marked as not included. The service never substitutes prototype
or estimated values after a report has been uploaded.

## API

### Health check

```http
GET /api/health
```

### Commerce chat (internal foundation)

```http
POST /internal/commerce-chat/messages
Content-Type: application/json
X-Muditam-Service-Secret: <service secret>
```

Commerce chat is deliberately separate from the report/health chat prompt and
guardrails. It returns conversational text messages and verified product-card
references as separate fields. A model-suggested product is returned only when
its slug exists in retrieved active, recommendation-eligible product knowledge.
This endpoint remains service-authenticated and is disabled unless
`MUDITAM_COMMERCE_CHAT_ENABLED=true`.

Example request:

```json
{
  "conversationId": "conversation-123",
  "visitorId": "visitor-123",
  "channel": "shopify_web",
  "language": "en",
  "message": "Suggest something for blood-sugar support",
  "recentMessages": []
}
```

The browser widget must not call this internal endpoint directly or contain the
service secret. It uses the public storefront session gateway below, which
applies origin checks, signed anonymous sessions, and visitor-level rate limits.

### Storefront commerce gateway

The initial browser gateway is available through:

```http
POST /api/v1/commerce/sessions
Origin: https://muditam.com

POST /api/v1/commerce/messages
Origin: https://muditam.com
Authorization: Bearer <signed storefront session token>
Content-Type: application/json
```

Session tokens are anonymous, signed, expire after 24 hours, and contain only a
random visitor ID and conversation ID. Configure a secret of at least 32
characters in `MUDITAM_COMMERCE_SESSION_SECRET`. Production origins default to
`https://muditam.com` and `https://www.muditam.com`; override them with a
comma-separated `MUDITAM_COMMERCE_ALLOWED_ORIGINS` value.

The gateway applies an in-process first layer of visitor/IP rate limiting. A
shared edge or Redis-backed limiter should be added before horizontally scaling
the service.

### Storefront widget

The isolated Shadow DOM widget lives in `apps/storefront-widget`. It can be
previewed and built with:

```bash
npm run widget:dev
npm run widget:typecheck
npm run widget:build
```

The production build emits `apps/storefront-widget/dist/muditam-chat.js`. The
current product card deliberately uses the verified product name, reason, and
URL only. Shopify-synchronized image, price, variant, availability, add-to-cart,
and attribution fields will be added to the backend contract rather than being
hardcoded in the widget.

### Process a report

The following direct routes are for local development and benchmark testing;
they are not public production APIs.

```http
POST /api/process
Content-Type: application/pdf
X-File-Name: report.pdf

<raw file bytes>
```

Supported content types:

- `application/pdf`
- `image/png`
- `image/jpeg`

The endpoint accepts raw file bytes, not multipart form data. The response is
the normalized report JSON. The current maximum request size is 20 MB. PDF.js
also enforces a 100-page PDF limit.

DOCX currently returns `415 UNSUPPORTED_DOCUMENT_TYPE`.

Example local request:

```bash
curl --request POST http://127.0.0.1:4173/api/process \
  --header "Content-Type: application/pdf" \
  --header "X-File-Name: report.pdf" \
  --data-binary @report.pdf
```

### Process multiple report photos

```http
POST /api/process-images
Content-Type: multipart/form-data

pages=<ordered PNG/JPEG>
pages=<ordered PNG/JPEG>
```

The multipart order defines report page order. The endpoint accepts 1–10
photos, with a maximum of 10 MB per photo. If some photos fail, the response is
`PARTIAL` and retains reliable observations from successful photos. If all
photos fail, the response is `UNREADABLE`.

Example:

```bash
curl --request POST http://127.0.0.1:4173/api/process-images \
  --form "pages=@page-1.jpg;type=image/jpeg" \
  --form "pages=@page-2.jpg;type=image/jpeg"
```

Uploaded bytes are processed in memory and are not intentionally persisted by
the service. Structured logs include request ID, MIME type, byte size, routing,
page numbers, durations, counts, and errors; they do not log extracted patient
values.

## Run locally

### Requirements

- Node.js 22 or newer
- npm
- an OpenAI API key for images or PDFs containing scanned pages

### Install

```bash
npm install
```

### Configure

```bash
cp .env.example .env
```

Set the server-side key in `.env`:

```dotenv
MUDITAM_OPENAI_API_KEY=your_key
MUDITAM_OPENAI_VISION_MODEL=gpt-5.6-luna
MUDITAM_REVIEW_HOST=127.0.0.1
MUDITAM_REVIEW_PORT=4173
```

The model can be overridden for benchmarking. Do not commit `.env`.

### Start for browser/local API use

```bash
npm run review
```

The API is available at `http://127.0.0.1:4173`. A local report-review page can
also be served at that address when `local-test-ui/index.html` exists. That UI
is intentionally local-only and ignored by Git.

### Start for the mobile app

```bash
npm run review:mobile
```

This binds the service to `0.0.0.0:4173`.

For an Android emulator or USB-connected Android device:

```bash
$ANDROID_HOME/platform-tools/adb reverse tcp:4173 tcp:4173
```

Then start the Expo app from the sibling frontend repository:

```bash
cd ../muditam-app-frontend
npx expo start -c
```

Upload or replace a report through the onboarding report-upload screen. The
screen accepts one PDF or up to 10 photos, displays their page order, and lets
the user add, remove, or reorder photos before extraction. Keep the AI-platform
terminal open to see the structured processing events.

For a physical device without ADB reverse, configure the frontend AI API URL to
use the development machine's LAN IP and ensure the device can reach port 4173.

## Command-line workflows

The CLI commands below operate on digital PDFs. The HTTP API is the integrated
path for automatic scanned-page Vision fallback.

Extract PDF.js text and layout:

```bash
npm run extract -- report.pdf output/extracted.json
```

Structure report rows:

```bash
npm run structure -- report.pdf output/structured.json
```

Produce canonical normalized observations:

```bash
npm run process -- report.pdf output/final.json
```

When the output path is omitted, the command writes JSON to standard output.
The `output/` directory is ignored because these artifacts may contain health
data.

## Testing and verification

Run the complete local verification suite:

```bash
npm run typecheck
npm test
npm run build
```

The automated suite covers PDF extraction and quality routing, scanned-page
rendering, table/column modeling, row structuring, vendor alias resolution,
normalization, validation, duplicate conflicts, source-page preservation, and
unreadable-image handling. Provider calls are mocked; tests do not spend OpenAI
credits.

To compare a digital PDF with a manually reviewed golden file:

```bash
npm run verify:report -- \
  test-data/sanitized-reports/report-001.pdf \
  test-fixtures/golden/report-001-core.json
```

Run all cases listed in the golden manifest:

```bash
npm run benchmark
```

Only fixtures marked `VERIFIED` should count toward extraction accuracy.
`DRAFT` fixtures require manual checking. Golden files are development QA data;
production reports do not require fixtures or manual review for every upload.

Local report corpora under `test-data/` are ignored because they may contain
protected health information. Do not commit real patient reports, generated
outputs, logs, `.env`, or the local prototype interfaces.

## Current boundaries before production

The extraction/OCR MVP is functional, but production rollout still requires:

- authentication between the application backend and this API;
- production persistence and retention rules;
- rate limiting, abuse protection, and stricter MIME/security checks;
- monitoring for accuracy, provider errors, latency, and cost;
- a representative, independently reviewed multi-vendor benchmark dataset;
- a confirmation/review workflow for uncertain or conflicting observations;
- encrypted/malformed PDF handling and deployment load testing; and
- image preprocessing benchmarks for rotation, cropping, and poor resolution.

Medical interpretation and patient-facing recommendations must be implemented
as a separate, versioned clinical layer with appropriate professional review.

## Local AI chat engine

The private chat endpoint is available only to the application backend:

```text
POST /internal/ai-chat/messages
X-Muditam-Service-Secret: <shared secret>
```

It accepts a limited recent history and a trusted allow-list of normalized
observations prepared by the main backend. It never loads a report using a
client-supplied patient ID. The response is a structured decision, answer,
verified observation citations, and verified knowledge references.

The local processing order is:

```text
deterministic emergency/medication guardrail
  -> keyword retrieval from versioned curated medical knowledge
  -> exact product lookup or MongoDB Atlas Vector Search
  -> active + recommendationEligible + websiteStatus filtering
  -> OpenAI Responses API with Structured Outputs and store=false
  -> category/decision enforcement
  -> product dosage and personalized-prescription enforcement
  -> observation and knowledge citation allow-listing
  -> safe normalized response
```

Configure:

```dotenv
AI_PLATFORM_SERVICE_SECRET=<same 32+ character backend secret>
MUDITAM_OPENAI_API_KEY=<server-side key>
MUDITAM_CHAT_MODEL=gpt-5.6-luna
MONGO_URI=<matching mobile app database for this environment>
MUDITAM_RAG_ENABLED=true
MUDITAM_EMBEDDING_MODEL=text-embedding-3-small
MUDITAM_EMBEDDING_DIMENSIONS=1024
MUDITAM_VECTOR_INDEX=muditam_knowledge_vector
```

The bundled medical entries remain a small curated seed. Website-backed product
knowledge is stored in `knowledge_sources` and `knowledge_chunks`; each chunk
retains its product slug, website URL, version, eligibility, and content hash.
An explicitly named product uses deterministic catalogue lookup. Broader product
questions use Atlas Vector Search, with MongoDB text retrieval as an operational
fallback. Products without active website pages cannot enter retrieval.

Product dosage, frequency, duration, and personalized product prescriptions are
blocked. Those decisions belong to a Muditam dietitian or doctor.

Refresh chunks after the mobile backend synchronizes `metabolic_products`:

```bash
# Read-only plan
npm run knowledge:ingest

# Generate embeddings and update MongoDB
npm run knowledge:ingest -- --apply

# First setup only: also create the Atlas vector index
npm run knowledge:ingest -- --apply --create-index
```

Text chat and the future LiveKit voice agent should both call this same engine;
LiveKit supplies speech-to-text and text-to-speech, not a separate medical
reasoning path.

### Chat evaluation

The initial evaluation corpus contains 50 synthetic English/Hindi cases across
report grounding, missing values, education, medication, diagnosis, emergency,
prompt injection, and off-topic requests. Every case is marked `DRAFT` until a
qualified clinical reviewer approves its expected behavior.

The full live evaluation is opt-in because it makes one or more billable OpenAI
requests. Start with a small group or limit:

```bash
MUDITAM_RUN_LIVE_CHAT_EVAL=true npm run eval:chat -- --group EMERGENCY
MUDITAM_RUN_LIVE_CHAT_EVAL=true npm run eval:chat -- --limit 5
```

Run the entire 50-case corpus only after the draft expectations have been
reviewed:

```bash
MUDITAM_RUN_LIVE_CHAT_EVAL=true npm run eval:chat
```

The runner prints pass rate, failure IDs/reasons, and total tokens without
printing prompts, answers, credentials, or patient data. Normal service logs
contain request ID, decision, category, guardrail stage, model, latency, token
counts, and citation count; they intentionally exclude message text and report
values.
