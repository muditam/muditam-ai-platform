import "dotenv/config";
import type { AnyBulkWriteOperation } from "mongoose";
import { loadMetabolicEnvironment } from "../../config/env.js";
import { DIABETES_KNOWLEDGE_ENTRIES } from "../../constants/diabetes-knowledge.js";
import { diabetesKnowledgeEntrySchema } from "../../contracts/knowledge.js";
import { createMetabolicLogger } from "../../observability/logger.js";
import {
  closeMetabolicDatabase,
  connectMetabolicDatabase,
} from "../connect.js";
import {
  getMetabolicKnowledgeEntryModel,
  type MetabolicKnowledgeEntryDocument,
} from "../models/metabolic-knowledge-entry.js";

export function buildKnowledgeSeedOperations(
  seededAt: Date,
): Array<AnyBulkWriteOperation<MetabolicKnowledgeEntryDocument>> {
  return DIABETES_KNOWLEDGE_ENTRIES.map((rawEntry) => {
    const entry = diabetesKnowledgeEntrySchema.parse(rawEntry);
    return {
      updateOne: {
        filter: { key: entry.key },
        update: {
          $set: {
            ...entry,
            keywords: [...entry.keywords],
          },
          $setOnInsert: { seededAt },
        },
        upsert: true,
        timestamps: false,
      },
    };
  });
}

async function seedKnowledge(): Promise<void> {
  const environment = loadMetabolicEnvironment();
  const logger = createMetabolicLogger(environment.METABOLIC_LOG_LEVEL);
  if (environment.METABOLIC_MONGODB_URI === undefined) {
    throw new Error(
      "METABOLIC_MONGODB_URI is required to seed diabetes knowledge.",
    );
  }
  const connection = await connectMetabolicDatabase(
    environment.METABOLIC_MONGODB_URI,
  );
  try {
    const model = getMetabolicKnowledgeEntryModel(connection);
    const result = await model.bulkWrite(
      buildKnowledgeSeedOperations(new Date()),
      { ordered: true },
    );
    logger.info("Diabetes knowledge seed completed.", {
      collection: model.collection.collectionName,
      entryCount: DIABETES_KNOWLEDGE_ENTRIES.length,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      upsertedCount: result.upsertedCount,
    });
  } finally {
    await closeMetabolicDatabase(connection);
  }
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isDirectExecution) {
  seedKnowledge().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        service: "metabolic-assistant",
        level: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unknown diabetes knowledge seed failure.",
      }),
    );
    process.exitCode = 1;
  });
}
