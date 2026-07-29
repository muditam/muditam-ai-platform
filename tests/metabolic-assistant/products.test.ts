import { describe, expect, it } from "vitest";
import {
  METABOLIC_PRODUCTS,
  metabolicProductSchema,
} from "../../src/modules/metabolic-assistant/constants/products.js";
import { buildProductSeedOperations } from "../../src/modules/metabolic-assistant/database/seeds/seed-products.js";

describe("metabolic product test catalog", () => {
  it("contains 20 unique, schema-valid SKU records", () => {
    expect(METABOLIC_PRODUCTS).toHaveLength(20);
    expect(new Set(METABOLIC_PRODUCTS.map((product) => product.sku)).size).toBe(
      20,
    );
    for (const product of METABOLIC_PRODUCTS) {
      expect(metabolicProductSchema.safeParse(product).success).toBe(true);
      expect(product.recommendationStatus).toBe("test_only");
      expect(product.composition.length).toBeGreaterThan(10);
    }
  });

  it("builds one idempotent SKU upsert per product", () => {
    const seededAt = new Date("2026-07-29T00:00:00.000Z");
    const operations = buildProductSeedOperations(seededAt);

    expect(operations).toHaveLength(METABOLIC_PRODUCTS.length);
    for (const operation of operations) {
      expect("updateOne" in operation).toBe(true);
      if ("updateOne" in operation) {
        expect(operation.updateOne.upsert).toBe(true);
        expect(operation.updateOne.timestamps).toBe(false);
        expect(operation.updateOne.filter).toHaveProperty("sku");
        expect(operation.updateOne.update).toHaveProperty("$setOnInsert", {
          seededAt,
        });
      }
    }
  });
});
