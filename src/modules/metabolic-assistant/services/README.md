# Services

This folder contains the main use-case logic.

- `report-ingestion-service.ts` uploads, reads, lists, and deletes reports.
- `diabetes-chat-service.ts` checks the report, normalizes it, applies limits,
  loads all reports selected for the conversation, prepares safe comparisons,
  calls the chat provider, enforces the final category decision, and saves the
  conversation.

Recommendation logic is not implemented in this phase.
