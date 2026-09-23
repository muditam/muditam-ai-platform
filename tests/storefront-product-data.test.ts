import { describe, expect, it } from "vitest";
import { storefrontProductData } from "../src/commerce/bot-flow-store.js";

describe("storefrontProductData", () => {
  it("uses the Shopify-synced URL, image, and first available variant", () => {
    const result = storefrontProductData({
      slug: "karela-jamun-fizz",
      productUrl: "https://www.muditam.com/products/old-handle",
      imageUrl: "https://legacy.example/image.jpg",
      websiteCatalog: {
        sourceUrl: "https://www.muditam.com/products/karela-jamun-juice",
        images: ["https://cdn.shopify.com/s/files/karela.jpg"],
        variants: [
          { shopifyVariantId: "111", available: false },
          { shopifyVariantId: "222", available: true },
        ],
      },
    });

    expect(result).toEqual({
      productSlug: "karela-jamun-fizz",
      productUrl: "https://www.muditam.com/products/karela-jamun-juice",
      imageUrl: "https://cdn.shopify.com/s/files/karela.jpg",
      shopifyVariantId: "222",
    });
  });

  it("falls back safely when Shopify sync data is incomplete", () => {
    const result = storefrontProductData({
      slug: "liver-fix",
      productUrl: "https://www.muditam.com/products/liver-fix",
      featuredImage: "https://cdn.shopify.com/s/files/liver.jpg",
      websiteCatalog: { images: [], variants: [] },
    });

    expect(result).toEqual({
      productSlug: "liver-fix",
      productUrl: "https://www.muditam.com/products/liver-fix",
      imageUrl: "https://cdn.shopify.com/s/files/liver.jpg",
      shopifyVariantId: null,
    });
  });
});
