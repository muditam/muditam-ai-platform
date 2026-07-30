# Metabolic Assistant Documentation

This folder explains the metabolic-assistant module in simple language.

## Current implementation point

The current flow ends after a blood report has been converted into validated
JSON and stored in MongoDB.

```text
PDF/JPEG/PNG upload
        |
        v
Private local file storage
        |
        v
MongoDB extraction job
        |
        v
OpenAI gpt-4o-mini
        |
        v
Strict JSON validation
        |
        v
JSON stored on metabolic_reports
```

Read [OPENAI_BLOOD_REPORT_EXTRACTION.md](./OPENAI_BLOOD_REPORT_EXTRACTION.md)
for setup, function-by-function flow, JSON structure, and verification steps.

## Deliberate stopping point

This module does not yet:

- approve extracted values;
- correct uncertain values;
- normalize or convert units;
- generate health recommendations;
- select products;
- provide report chat;
- require authentication.

Those capabilities must consume the validated extraction JSON in later phases.

