import { describe, expect, it } from "vitest";
import { loadMetabolicEnvironment } from "../../src/modules/metabolic-assistant/config/env.js";
import { createHealthRouter } from "../../src/modules/metabolic-assistant/http/routes/health-routes.js";

describe("metabolic assistant health router", () => {
  it("can be composed without database, storage, or OpenAI dependencies", () => {
    const environment = loadMetabolicEnvironment({
      NODE_ENV: "test",
      ENABLE_METABOLIC_ASSISTANT: "true",
    });

    const router = createHealthRouter({
      environment,
      now: () => new Date("2026-07-29T00:00:00.000Z"),
    });

    expect(router).toBeDefined();
    expect(router.stack).toHaveLength(1);
  });
});
