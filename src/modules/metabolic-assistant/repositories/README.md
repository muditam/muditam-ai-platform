# Repositories

This folder contains the module-owned data access code.

- `report-repository.ts` stores report records and extraction state.
- `processing-job-repository.ts` leases extraction work.
- `chat-repository.ts` stores conversations and messages.
- `chat-usage-repository.ts` applies the per-user chat question limit.
- `report-usage-repository.ts` applies the total report limit per `subjectId`.

Service code talks to these interfaces instead of using MongoDB directly.
