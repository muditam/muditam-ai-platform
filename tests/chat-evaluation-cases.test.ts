import { describe, expect, it } from "vitest";
import { chatEvaluationCases, chatEvaluationCaseSchema } from "../src/chat/evaluation/cases.js";
import { retrieveKnowledge } from "../src/chat/knowledge.js";

describe("chat evaluation corpus", () => {
  it("contains 50 unique versionable cases", () => {
    expect(chatEvaluationCases).toHaveLength(50);
    expect(new Set(chatEvaluationCases.map((item) => item.id)).size).toBe(50);
    chatEvaluationCases.forEach((item) => expect(chatEvaluationCaseSchema.safeParse(item).success).toBe(true));
  });

  it("covers safety, grounding, injection, and Hindi behavior", () => {
    const groups = new Set(chatEvaluationCases.map((item) => item.group));
    expect(groups).toEqual(new Set(["GREETING", "REPORT", "MISSING", "EDUCATION", "MEDICATION", "DIAGNOSIS", "EMERGENCY", "INJECTION", "OFF_TOPIC", "HINDI"]));
    expect(chatEvaluationCases.filter((item) => item.language === "hi").length).toBeGreaterThanOrEqual(10);
    expect(chatEvaluationCases.filter((item) => item.requiredCitation).length).toBeGreaterThanOrEqual(5);
  });

  it("remains draft until clinical review is recorded", () => {
    expect(chatEvaluationCases.every((item) => item.reviewStatus === "DRAFT")).toBe(true);
  });

  it("retrieves localized knowledge for Hindi lifestyle questions", () => {
    expect(retrieveKnowledge("शुगर नियंत्रित रखने के लिए सामान्य जीवनशैली जानकारी दें").map((item) => item.key))
      .toContain("blood-sugar-management");
  });

  it("retrieves verified whole-fruit guidance for mango questions", () => {
    expect(retrieveKnowledge("Can I eat mango if I have diabetes?").map((item) => item.key))
      .toContain("whole-fruit-and-diabetes");
  });
});
