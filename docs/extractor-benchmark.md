# PDF Extractor Benchmark

Date: 2026-07-29

## Decision

Use PDF.js as the primary extractor for digital PDFs. Preserve every positioned
text item and construct a deterministic layout layer over those items.

Do not put Docling in the default path for the current report corpus. Re-evaluate
it as an escalation path after the corpus contains multiple laboratories and
genuinely difficult layouts.

This decision does not apply to image-only pages. OCR will be benchmarked
separately.

## Corpus

- 14 unique, de-identified reports
- 207 pages
- 14 to 17 pages per report
- Digital PDFs with embedded text
- One laboratory/template family
- English report content
- No representative Hindi or scanned reports

The narrow corpus is sufficient to select the initial extractor for this
template. It is not sufficient to claim general accuracy across laboratories.

## Compared configurations

### PDF.js

- Package: `pdfjs-dist`
- Version: 6.2.108
- OCR: none
- Output: page text plus every positioned text item
- Standard font data configured locally

### Docling

- Version: 2.115.0
- Standard PDF pipeline
- OCR: disabled
- Layout detection: enabled
- Table structure: enabled
- TableFormer mode: accurate
- CPU threads: 4
- Output: lossless JSON and Markdown

## Results

| Measurement | PDF.js | Docling |
|---|---:|---:|
| Successful reports | 14/14 | 14/14 |
| Successful pages | 207/207 | 207/207 |
| Median time per report | 159 ms | 29,427 ms |
| P95 time per report | 261 ms | 48,885 ms |
| Total corpus time | 2.3 s | 430.3 s |
| Maximum observed process RSS | 197 MB | 857 MB |
| Structured tables returned | Not applicable | 285 |
| Structured table cells returned | Not applicable | 6,670 |

The median measured runtime ratio was 182.2x. These measurements were made on
the local development machine and should not be treated as Heroku capacity
numbers. A deployment benchmark is still required before selecting a dyno.

## Content comparison

Numeric occurrences were compared as normalized multisets across the full text
from both extractors.

- 99.51% of numeric occurrences emitted by Docling also appeared in PDF.js.
- 92.45% of numeric occurrences emitted by PDF.js also appeared in Docling.

The unmatched PDF.js occurrences were dominated by repeated page numbers,
reference-table values, and footer identifiers. This metric measures agreement,
not clinical accuracy, and does not prove that either extractor is correct.

A manual structural check of the first laboratory table confirmed that both
extractors preserved the checked biomarker name, value, unit, and reference
range associations. PDF.js returned them in usable reading order. Docling
additionally returned explicit rows and cells with bounding-box provenance.

## Interpretation

Docling provides useful document intelligence, especially explicit table
structure. For this corpus, however, the source PDFs already expose clean text
in row order. PDF.js retains the underlying coordinates and values at a much
lower runtime and memory cost.

The correct initial architecture is:

```text
Digital PDF
    |
    v
PDF.js positioned extraction
    |
    v
Deterministic line and row reconstruction
    |
    v
Extraction quality validation
    |
    +-- reliable layout -> canonical document
    |
    +-- ambiguous layout -> escalation candidate
```

Docling should become an escalation candidate only if additional templates show
that deterministic reconstruction cannot reliably associate biomarker names,
values, units, and reference ranges.

## Limitations

- The reports come from one laboratory/template family.
- The benchmark has no manually labelled complete biomarker ground truth yet.
- Hindi PDFs were not represented.
- Scanned and mixed text/image PDFs were not represented.
- Peak memory sampling represents the process on macOS, not a Heroku container.
- Timing includes extraction and serialization to local benchmark artifacts.

## Next engineering step

Implement the canonical PDF.js extraction layer with:

1. Input validation and explicit processing limits.
2. Page-level positioned text items.
3. Deterministic line reconstruction.
4. Table/column candidate detection without dropping any text.
5. Page-level extraction-quality diagnostics.
6. An explicit `OCR_REQUIRED` classification for pages without usable text.
7. Versioned canonical JSON.
8. Golden tests based on the current sanitized reports.

After that foundation is stable, create manually verified biomarker rows for a
subset of reports and evaluate report structuring separately from raw PDF text
extraction.
