import { describe, expect, it } from "vitest";
import {
  directProcessingAllowed,
  isLoopbackAddress,
  reviewUiAllowed,
} from "../src/server/access-policy.js";

describe("production route access policy", () => {
  it("keeps the local review UI outside production only", () => {
    expect(reviewUiAllowed("development")).toBe(true);
    expect(reviewUiAllowed("production")).toBe(false);
  });

  it("blocks external direct-processing calls in production", () => {
    expect(directProcessingAllowed("production", "10.0.0.8")).toBe(false);
    expect(directProcessingAllowed("production", "203.0.113.4")).toBe(false);
  });

  it("allows loopback processing so the authenticated internal route can reuse the pipeline", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(directProcessingAllowed("production", "127.0.0.1")).toBe(true);
  });

  it("keeps direct local testing available in development", () => {
    expect(directProcessingAllowed("development", "10.0.2.2")).toBe(true);
  });
});
