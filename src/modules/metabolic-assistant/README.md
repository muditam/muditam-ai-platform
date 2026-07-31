# Metabolic Assistant Module

This directory is the isolated home of the blood-report and metabolic-assistant
API described in `docs/metabolic-assistant/PHASED_ARCHITECTURE_PLAN.md`.

## Current scope

The isolated foundation and extraction path now include:

- typed environment configuration;
- feature flags;
- an Express application composition root;
- request IDs and a stable error envelope;
- a health endpoint;
- a safe structured logger;
- a validated 20-product test catalog;
- a module-owned MongoDB product model;
- an idempotent MongoDB product seed command;
- private PDF/JPEG/PNG storage and open report endpoints;
- Mongo-backed extraction job leasing and bounded retries;
- a provider-neutral extraction contract;
- an OpenAI Responses API adapter using `gpt-4o-mini`;
- strict structured-output and canonical JSON validation.
- shared, versioned basic report normalization;
- report-grounded diabetes chat with fixed topic categories;
- configurable persona, rejection, safety, and disclaimer text;
- Mongo-backed conversations and messages;
- atomic per-user question limits.
- atomic total report limits per upload `subjectId`;
- multi-report conversations;
- deterministic same-unit biomarker comparisons before AI explanation.

With the worker enabled, an uploaded report moves through `QUEUED`,
`PROCESSING`, and `NEEDS_REVIEW`. At that stopping point the validated
extraction JSON is available through the report endpoint. Chat can use reports
in `NEEDS_REVIEW` or `READY` state and clearly reports that review is pending.
Review/correction, recommendations, and authentication are not implemented.

The easy chat guide is in
`docs/asisstant-docs/DIABETES_REPORT_CHAT.md`.
The complete manual testing guide is in
`docs/asisstant-docs/COMPLETE_FLOW_TESTING_GUIDE.md`.

## Run

Copy `.env.example` to `.env`, add values, and run:

```bash
npm run start:metabolic
```

Health endpoint:

```text
GET /api/v1/metabolic-assistant/health
```

## Seed the test product catalog

Set `METABOLIC_MONGODB_URI` in `.env`, then run:

```bash
npm run seed:metabolic-products
```

The command upserts products by exact SKU and is safe to rerun.

## Isolation rule

Code in this module must not import the experimental `src/pdf` extractor,
`src/cli.ts`, the root `src/index.ts`, or generated `dist` files.
