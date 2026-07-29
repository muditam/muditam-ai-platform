# Metabolic Assistant Basic Setup — Simple Explanation

## What we built

We created a separate area for the new metabolic assistant:

```text
src/modules/metabolic-assistant
```

Keeping it separate means the old PDF/OCR experiment does not control or affect
the new feature.

## Basic flow

```text
.env values
    |
    v
Typed environment validation
    |
    v
Metabolic server starts
    |
    v
GET /api/v1/metabolic-assistant/health
```

The health endpoint proves that the new module can start. It does not connect to
OpenAI, process a report, or start a chat.

## Main folders

- `config`: reads and validates environment values.
- `constants`: contains the temporary product catalog.
- `contracts`: defines valid API and error shapes.
- `database`: contains module-owned MongoDB code.
- `http`: contains the Express app, routes, and middleware.
- `observability`: contains safe structured logging.
- `adapters`, `repositories`, `services`, and `workers`: reserved boundaries for
  later phases.

## Environment file

`.env.example` lists every planned key. A developer copies it to `.env` and
fills in secret values locally. `.env` is ignored by Git.

Important keys currently used:

- `ENABLE_METABOLIC_ASSISTANT`
- `METABOLIC_HOST`
- `METABOLIC_PORT`
- `METABOLIC_API_PREFIX`
- `METABOLIC_LOG_LEVEL`
- `METABOLIC_MONGODB_URI` for product seeding

OpenAI and storage keys are placeholders for later phases.

## Commands

```bash
npm run start:metabolic
npm run test:metabolic
npm run typecheck
npm test
npm run build
```

## What is intentionally not built yet

- report upload;
- blood-report extraction;
- OpenAI calls;
- chat;
- report database models;
- authentication;
- use of the old OCR/PDF experiment.
