import { describe, expect, it } from "vitest";
import { detectCommerceLanguage } from "../src/commerce/language.js";

describe("commerce language detection", () => {
  it.each([
    "yes mai insulin le raha hu",
    "mujhe sugar ke liye product chahiye",
    "kya liver ke liye kuch hai?",
    "is product ko kaise lena hai",
    "haan mai diabetes patient hu",
    "order kab deliver hoga",
    "mere liye best supplement kaunsa hai",
    "can I take this medicine ke saath?",
  ])("detects Hinglish: %s", (message) => {
    expect(detectCommerceLanguage(message, "en")).toBe("hinglish");
  });

  it("detects Devanagari Hindi", () => {
    expect(detectCommerceLanguage("मुझे डायबिटीज़ है", "en")).toBe("hi");
  });

  it.each([
    "what is the main benefit of this product?",
    "can you tell me the price?",
    "is this product available?",
  ])("keeps English when there are no Roman-Hindi signals: %s", (message) => {
    expect(detectCommerceLanguage(message, "en")).toBe("en");
  });
});
