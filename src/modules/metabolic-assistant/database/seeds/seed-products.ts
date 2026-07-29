import "dotenv/config";
import type { AnyBulkWriteOperation } from "mongoose";
import { loadMetabolicEnvironment } from "../../config/env.js";
import {
  METABOLIC_PRODUCTS,
  metabolicProductSchema,
} from "../../constants/products.js";
import { createMetabolicLogger } from "../../observability/logger.js";
import {
  closeMetabolicDatabase,
  connectMetabolicDatabase,
} from "../connect.js";
import {
  getMetabolicProductModel,
  type MetabolicProductDocument,
} from "../models/metabolic-product.js";

export function buildProductSeedOperations(
  seededAt: Date,
): Array<AnyBulkWriteOperation<MetabolicProductDocument>> {
  return METABOLIC_PRODUCTS.map((entry) => {
    const product = metabolicProductSchema.parse(entry);
    return {
      updateOne: {
        filter: { sku: product.sku },
        update: {
          $set: {
            ...product,
            applicableBiomarkers: [...product.applicableBiomarkers],
            keyIngredients: [...product.keyIngredients],
            contraindications: [...product.contraindications],
            safetyNotes: [...product.safetyNotes],
          },
          $setOnInsert: {
            seededAt,
          },
        },
        upsert: true,
        timestamps: false,
      },
    };
  });
}

async function seedProducts(): Promise<void> {
  const environment = loadMetabolicEnvironment();
  const logger = createMetabolicLogger(environment.METABOLIC_LOG_LEVEL);
  const uri = environment.METABOLIC_MONGODB_URI;

  if (uri === undefined) {
    throw new Error(
      "METABOLIC_MONGODB_URI is required to seed metabolic products.",
    );
  }

  const connection = await connectMetabolicDatabase(uri);
  try {
    const productModel = getMetabolicProductModel(connection);
    const operations = buildProductSeedOperations(new Date());
    const result = await productModel.bulkWrite(operations, { ordered: true });
    const catalogSkus = METABOLIC_PRODUCTS.map((product) => product.sku);
    const verifiedCount = await productModel.countDocuments({
      sku: { $in: catalogSkus },
    });

    if (verifiedCount !== METABOLIC_PRODUCTS.length) {
      throw new Error(
        `Seed verification failed: expected ${METABOLIC_PRODUCTS.length} products but found ${verifiedCount}.`,
      );
    }

    logger.info("Metabolic product seed completed.", {
      collection: productModel.collection.collectionName,
      catalogCount: METABOLIC_PRODUCTS.length,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      upsertedCount: result.upsertedCount,
      verifiedCount,
    });
  } finally {
    await closeMetabolicDatabase(connection);
  }
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isDirectExecution) {
  seedProducts().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown product seed failure.";
    console.error(
      JSON.stringify({
        service: "metabolic-assistant",
        level: "error",
        message,
      }),
    );
    process.exitCode = 1;
  });
}
