# Muditam AI Platform

Blood-report extraction and normalization service used by the Muditam mobile
application.

The current implementation handles digital PDFs, scanned PDFs, mixed PDFs,
PNG images, and JPEG images. It extracts printed laboratory observations and
maps them to a versioned biomarker catalogue. It does not diagnose a patient,
invent missing results, or generate estimated dashboard values.

DOCX extraction, clinical interpretation, AI chat, and voice are not included
in this milestone.

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

### Canonical mapping and validation

All PDF.js and Vision observations enter the same deterministic pipeline:

1. Parse values and reference ranges without changing the printed fact.
2. Resolve approved vendor aliases against the versioned biomarker catalogue.
3. Use conservative token-signature matching only when aliases do not match.
4. Check panel context and unit compatibility.
5. Detect conflicting duplicate values.
6. Preserve unmapped or uncertain observations for review.

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

### Process a report

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

Upload or replace a report through the onboarding report-upload screen. Keep
the AI-platform terminal open to see the structured processing events.

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
