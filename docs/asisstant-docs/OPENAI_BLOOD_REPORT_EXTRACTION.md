# OpenAI Blood Report Extraction — Easy Implementation Guide

## 1. What this phase does

This phase accepts a blood-report PDF or image and converts the visible report
content into a predictable JSON object.

The OpenAI API acts as the current text-and-visual extraction provider. The
configured model is:

```text
gpt-4o-mini
```

The commonly mistyped name `gpt40-mini` is not the API model name.

The implementation supports PDF, JPEG/JPG, and PNG. It stops after valid
extracted JSON is stored and can be read through the report API. It does not
make recommendations.

## 2. Why this is still decoupled from OpenAI

The rest of the system does not directly use an OpenAI response.

```text
OpenAI API response
        |
        v
OpenAIReportExtractor
        |
        v
CanonicalExtractionResult
        |
        v
MongoDB and future application logic
```

`OpenAIReportExtractor` implements the provider-neutral `ReportExtractor`
interface. A future OCR engine can implement the same interface:

```ts
interface ReportExtractor {
  providerKind: "openai" | "ocr" | "manual" | "test";
  extract(input: ReportExtractionInput): Promise<CanonicalExtractionResult>;
}
```

As long as an extractor returns a valid `CanonicalExtractionResult`, the
worker, database, review flow, and recommendation flow do not need to change.

## 3. Complete flow in simple language

### Step 1 — Upload a report

The client sends a multipart request:

```text
POST /api/v1/metabolic-assistant/reports
```

The multipart file field must be named `report`.

`ReportController.upload()` reads the uploaded file and passes its bytes to
`ReportIngestionService.upload()`.

### Step 2 — Validate and store the source file

`ReportIngestionService.upload()`:

1. checks that the file is not empty;
2. accepts only PDF, JPEG, or PNG;
3. verifies that the file bytes match the declared file type;
4. calculates a SHA-256 fingerprint;
5. creates a report ID;
6. stores the file in private local storage;
7. creates a `metabolic_reports` document;
8. creates one `metabolic_processing_jobs` document.

The report and job initially have these statuses:

```text
report.status = QUEUED
job.status    = queued
```

The upload response is `202 Accepted` because extraction happens in the
background.

### Step 3 — Lease one job safely

`ProcessingJobRepository.leaseNext()` atomically selects one available job.
This means two workers cannot successfully claim the same queued job at the
same time.

The leased job contains the job ID, report ID, current attempt number, and
lease expiry time. If a worker crashes, the expired lease makes the job
eligible for another attempt.

### Step 4 — Load the private report

`ExtractionWorker.runOnce()`:

1. leases one job;
2. loads its report record;
3. changes the report status to `PROCESSING`;
4. calls `LocalReportStorage.read()` with the private object key;
5. sends the bytes to the configured `ReportExtractor`.

The storage path is never returned by the public API.

### Step 5 — Build the OpenAI request

`OpenAIReportExtractor.extract()` handles PDF and image input differently.

For a PDF it creates an OpenAI `input_file` item using a Base64 PDF data URL:

```text
{
  type: "input_file",
  filename,
  file_data: "data:application/pdf;base64,<encoded bytes>"
}
```

For JPEG or PNG it creates an `input_image` data URL:

```text
{ type: "input_image", image_url, detail: "high" }
```

The adapter calls the OpenAI Responses API with:

- model `gpt-4o-mini`;
- the blood-report extraction prompt;
- the report file or image;
- a strict Zod-backed Structured Output definition;
- `store: false` by default.

Official OpenAI references:

- [File inputs](https://developers.openai.com/api/docs/guides/file-inputs)
- [Images and vision](https://developers.openai.com/api/docs/guides/images-vision)
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [GPT-4o mini](https://developers.openai.com/api/docs/models/gpt-4o-mini)

### Step 6 — Protect against invented or malformed data

`buildBloodReportExtractionPrompt()` tells the model:

- extract only visible facts;
- never diagnose;
- never recommend treatment;
- never invent missing values;
- preserve the printed label, value, unit, range, flag, and page;
- use `UNKNOWN` when a printed status is not present;
- lower confidence for blurry or ambiguous data;
- use `other` when a biomarker cannot be mapped safely;
- return no biomarkers when the input is not a blood report.

The response must pass `openAIExtractionPayloadSchema`.

The model is not trusted to generate the internal report ID, file hash,
provider/model identity, prompt version, OpenAI response ID, or extraction
timestamp. `OpenAIReportExtractor` adds these trusted values in application
code.

The complete object must then pass `canonicalExtractionResultSchema`. Invalid
JSON is rejected and is never saved as a successful extraction.

### Step 7 — Store JSON or retry

On success:

```text
report.status     = NEEDS_REVIEW
report.extraction = validated canonical JSON
job.status        = completed
```

`NEEDS_REVIEW` does not mean the extraction failed. It means a person or a
future review phase should confirm the extracted report before recommendations
use it.

On a temporary failure:

```text
report.status = QUEUED
job.status    = queued
```

The job retries with a delay. After the maximum attempts:

```text
report.status = FAILED
job.status    = dead_letter
```

Only a safe error code/message is stored. Report contents are not written to
logs. The safe `failure` object is returned by the report status endpoint so a
developer can see why extraction stopped. A file identified as not being a
blood report fails immediately instead of wasting additional API attempts.

## 4. JSON structure we are aiming for

The following is a readable example. Actual fields not present on the source
report are omitted.

```json
{
  "schemaVersion": "1.0.0",
  "reportId": "507f1f77bcf86cd799439011",
  "provider": {
    "kind": "openai",
    "name": "openai-responses",
    "version": "1",
    "model": "gpt-4o-mini",
    "promptVersion": "1.0.0",
    "responseId": "resp_..."
  },
  "source": {
    "fileName": "blood-report.pdf",
    "mimeType": "application/pdf",
    "sha256": "64-character-sha256-value",
    "pageCount": 3
  },
  "patient": {
    "name": "Patient name printed on report",
    "age": 42,
    "dateOfBirth": "1984-05-10",
    "sex": "female"
  },
  "laboratory": {
    "name": "Laboratory name",
    "reportIdentifier": "LAB-12345",
    "specimenType": "Serum",
    "fastingStatus": "FASTING",
    "collectedAt": "2026-07-29",
    "reportedAt": "2026-07-30"
  },
  "biomarkers": [
    {
      "id": "hba1c-1",
      "canonicalCode": "hba1c",
      "panel": "GLYCEMIC",
      "sourceLabel": "HbA1c",
      "numericValue": 6.2,
      "unit": "%",
      "sourceReferenceRange": "4.0 - 5.6",
      "referenceLower": 4,
      "referenceUpper": 5.6,
      "sourceFlag": "H",
      "status": "HIGH",
      "confidence": 0.98,
      "sourcePage": 1,
      "evidenceText": "HbA1c 6.2 % H",
      "reviewState": "UNREVIEWED"
    }
  ],
  "warnings": [
    {
      "code": "AMBIGUOUS_UNIT",
      "message": "The unit was not clearly readable.",
      "sourcePage": 2
    }
  ],
  "extractedAt": "2026-07-30T05:00:00.000Z"
}
```

## 5. Meaning of the important JSON fields

### Source and provider fields

| Field | Why it exists |
| --- | --- |
| `schemaVersion` | Lets us change the format safely later. |
| `reportId` | Connects the JSON to its MongoDB report. |
| `provider.kind` | Identifies OpenAI, OCR, manual, or test extraction. |
| `provider.model` | Records the exact configured model. |
| `provider.promptVersion` | Lets us compare results after prompt changes. |
| `provider.responseId` | Traces one API response without storing raw output. |
| `source.sha256` | Proves which uploaded file produced this JSON. |
| `sourcePage` | Helps a reviewer locate the original value. |
| `evidenceText` | Preserves the small visible text fragment supporting it. |

### Biomarker value fields

| Field | Meaning |
| --- | --- |
| `canonicalCode` | Stable application name such as `hba1c`. |
| `sourceLabel` | Exact label printed by the laboratory. |
| `numericValue` | Parsed number when clearly readable. |
| `textValue` | Non-numeric result such as `Reactive`. |
| `unit` | Exact printed unit. |
| `sourceReferenceRange` | Exact printed range text. |
| `referenceLower` / `referenceUpper` | Parsed boundaries when clear. |
| `sourceFlag` | Exact printed flag such as `H`, `L`, or `Critical`. |
| `status` | `LOW`, `NORMAL`, `HIGH`, `CRITICAL`, or `UNKNOWN`. |
| `confidence` | Extraction confidence from 0 to 1. |
| `reviewState` | Whether later human review is required. |

## 6. Canonical biomarker codes

These stable codes make future rules independent of laboratory wording:

```text
hba1c
glucose_fasting
glucose_post_prandial
glucose_random
insulin_fasting
homa_ir
cholesterol_total
ldl_cholesterol
hdl_cholesterol
triglycerides
vldl_cholesterol
non_hdl_cholesterol
apolipoprotein_b
apolipoprotein_a1
vitamin_d_25_oh
vitamin_b12
tsh
free_t3
free_t4
creatinine
egfr
alt
ast
ggt
uric_acid
hs_crp
hemoglobin
ferritin
other
```

`other` preserves an unrecognized test instead of forcing the wrong mapping.

## 7. Parameters needed for later recommendations

Recommendations are not implemented in this phase. When added, application
code should use deterministic approved rules rather than allowing the model to
freely choose a product.

| Parameter | Future usage |
| --- | --- |
| `canonicalCode` | Select the approved rule for the correct biomarker. |
| `numericValue` | Compare the reviewed result with an approved threshold. |
| `unit` | Interpret the value using the correct measurement unit. |
| `referenceLower` / `referenceUpper` | Use the report range where approved. |
| `status` | Use the printed/confirmed low, normal, or high state. |
| `patient.age` | Apply only medically approved age restrictions. |
| `patient.sex` | Apply only approved sex-specific interpretation. |
| `laboratory.fastingStatus` | Distinguish fasting from non-fasting results. |
| `laboratory.collectedAt` | Avoid using a stale report without a rule. |
| `confidence` | Block uncertain extraction from recommendations. |
| `reviewState` | Require confirmation before recommendation usage. |
| `warnings` | Block or qualify ambiguous source data. |

Before recommendation matching, a later phase must review/correct uncertain
values, normalize units deterministically, preserve the original extraction,
apply clinically approved thresholds, and check product exclusions and
contraindications. The model must not invent thresholds, dosages, claims, or
SKUs.

## 8. Environment setup

Add the API key to `.env`:

```dotenv
METABOLIC_OPENAI_API_KEY=your_openai_api_key
METABOLIC_EXTRACTION_MODEL=gpt-4o-mini
METABOLIC_OPENAI_STORE=false
METABOLIC_OPENAI_TIMEOUT_MS=120000

METABOLIC_WORKER_ENABLED=true
METABOLIC_WORKER_CONCURRENCY=1
METABOLIC_MAX_JOB_ATTEMPTS=3
METABOLIC_WORKER_POLL_INTERVAL_MS=2000
METABOLIC_JOB_LEASE_MS=180000
```

Do not commit `.env`.

The worker can remain disabled while testing only upload/list/delete:

```dotenv
METABOLIC_WORKER_ENABLED=false
```

## 9. How to run and verify a real extraction

Start the module:

```bash
npm run start:metabolic
```

Upload a PDF:

```bash
curl -X POST \
  http://localhost:3100/api/v1/metabolic-assistant/reports \
  -F "report=@/absolute/path/to/blood-report.pdf" \
  -F "displayName=Blood report test"
```

JPEG and PNG use the same `report` field.

Copy the returned report ID and poll:

```bash
curl \
  http://localhost:3100/api/v1/metabolic-assistant/reports/REPORT_ID
```

Expected status sequence:

```text
QUEUED -> PROCESSING -> NEEDS_REVIEW
```

At `NEEDS_REVIEW`, `data.report.extraction` contains the canonical JSON.

### Accuracy verification checklist

Compare the JSON against the original file:

1. Is every extracted marker visibly present?
2. Does `sourceLabel` preserve the laboratory label?
3. Are decimal points and signs correct?
4. Does each numeric value have the correct unit?
5. Is the reference range copied correctly?
6. Does `sourcePage` point to the correct PDF page?
7. Are fasting and collection details only present when printed?
8. Are blurry values marked with lower confidence or warnings?
9. Are missing fields omitted rather than invented?
10. Are unknown markers stored as `other` instead of incorrectly mapped?

Passing the JSON schema proves the shape is valid. It does not alone prove
medical accuracy; comparison with the original report is still required.

## 10. Important functions and where they live

| Function/class | Responsibility |
| --- | --- |
| `ReportController.upload()` | Converts HTTP upload into service input. |
| `ReportIngestionService.upload()` | Validates, stores, and queues a report. |
| `LocalReportStorage.read()` | Reads private bytes for the worker. |
| `ProcessingJobRepository.leaseNext()` | Claims one job atomically. |
| `ExtractionWorker.runOnce()` | Coordinates one extraction attempt. |
| `buildBloodReportExtractionPrompt()` | Supplies extraction-only instructions. |
| `OpenAIReportExtractor.extract()` | Calls OpenAI and creates canonical JSON. |
| `openAIExtractionPayloadSchema` | Validates the model-generated portion. |
| `canonicalExtractionResultSchema` | Validates the full neutral result. |
| `ReportRepository.saveExtraction()` | Stores JSON and sets `NEEDS_REVIEW`. |
| `ReportController.get()` | Returns status and JSON for verification. |

## 11. What is deliberately left for the next phase

- human review and correction endpoint;
- preservation of manual corrections;
- deterministic alias refinement and unit conversion;
- clinically approved ranges and urgent flags;
- recommendation rules and SKU matching;
- product explanations;
- report-grounded chat;
- authentication.

This stopping point keeps extraction testable before medical and product logic
is built on top of it.
