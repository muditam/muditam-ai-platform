import { describe, expect, it } from "vitest";
import { loadMetabolicEnvironment } from "../../src/modules/metabolic-assistant/config/env.js";

describe("metabolic assistant environment", () => {
  it("loads safe basic defaults", () => {
    const environment = loadMetabolicEnvironment({
      NODE_ENV: "test",
    });

    expect(environment.ENABLE_METABOLIC_ASSISTANT).toBe(false);
    expect(environment.METABOLIC_PORT).toBe(3100);
    expect(environment.METABOLIC_API_PREFIX).toBe(
      "/api/v1/metabolic-assistant",
    );
    expect(environment.METABOLIC_MONGODB_URI).toBeUndefined();
    expect(environment.METABOLIC_OPENAI_API_KEY).toBeUndefined();
  });

  it("rejects invalid boolean and numeric values", () => {
    expect(() =>
      loadMetabolicEnvironment({
        ENABLE_METABOLIC_ASSISTANT: "sometimes",
        METABOLIC_PORT: "not-a-port",
      }),
    ).toThrow();
  });
});
