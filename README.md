# Muditam AI Platform

Document-processing and AI services for Muditam.

The current milestone implements deterministic extraction from digital PDFs.
OCR, biomarker structuring, clinical rules, OpenAI interpretation, chat, and
voice are intentionally outside the current module.

## Requirements

- Node.js 22 or newer
- npm

## Install

```bash
npm install
```

## Extract a PDF

Write canonical JSON to a file:

```bash
npm run extract -- report.pdf extraction.json
```

Write canonical JSON to standard output:

```bash
npm run extract -- report.pdf
```

The extractor:

- validates the PDF header, byte limit, and page limit;
- extracts every PDF.js text fragment with page coordinates;
- reconstructs deterministic text lines;
- retains raw items so layout logic can be improved later;
- records PDF metadata and a SHA-256 checksum;
- returns page- and document-level quality diagnostics;
- marks image-only pages as `OCR_REQUIRED` without invoking OCR; and
- validates its result against a versioned runtime schema.

Default limits are 20 MB and 100 pages. Library callers can override them through
`ExtractPdfOptions`.

## Library usage

```ts
import { extractPdf } from "./src/index.js";

const result = await extractPdf(pdfBytes, {
  fileName: "report.pdf",
  documentId: "your-internal-document-id",
  maxBytes: 20 * 1024 * 1024,
  maxPages: 100,
});
```

Do not treat reconstructed text as a medical interpretation. The source items,
coordinates, values, units, ranges, and flags must pass through separate
structuring and validation stages before anything is shown to a patient.

## Quality statuses

Page statuses:

- `GOOD`: meaningful embedded text was extracted.
- `SUSPECT`: text exists but quality signals require validation.
- `OCR_REQUIRED`: image content exists without sufficient usable text.
- `EMPTY`: no text or image content was detected.

Document statuses:

- `EXTRACTED`
- `PARTIAL`
- `OCR_REQUIRED`

## Verification

```bash
npm run typecheck
npm test
npm run build
```

Local report corpora under `test-data/` are ignored by Git because they can
contain sensitive health information.
