import { describe, expect, it } from "vitest";
import { resolveBiomarker } from "../src/index.js";

describe("resolveBiomarker", () => {
  it("maps reordered vendor wording through medical token signatures", () => {
    const result = resolveBiomarker({
      rawName: "Serum Glycosylated Haemoglobin HbA1c Test",
      panel: "Diabetes Profile",
      unit: "%",
    });

    expect(result).toMatchObject({
      status: "MAPPED",
      method: "TOKEN_SIGNATURE",
      confidence: 0.99,
      definition: { canonicalCode: "HBA1C" },
    });
    expect(result.evidence).toContain(
      "Medical identity tokens match regardless of word order",
    );
  });

  it("expands common cholesterol abbreviations and specimen prefixes", () => {
    const result = resolveBiomarker({
      rawName: "Serum HDL-C",
      panel: "Lipid Profile",
      unit: "mg/dL",
    });

    expect(result.status).toBe("MAPPED");
    expect(result.definition?.canonicalCode).toBe("HDL_CHOLESTEROL");
  });

  it("does not guess when medical identity tokens are insufficient", () => {
    const result = resolveBiomarker({
      rawName: "Serum Cholesterol Result",
      unit: "mg/dL",
    });

    expect(result.status).toBe("UNMAPPED");
    expect(result.definition).toBeUndefined();
  });

  it("rejects a serum biomarker candidate when the panel identifies urine", () => {
    const result = resolveBiomarker({
      rawName: "Urine Protein Albumin",
      panel: "Urine Routine Examination",
      unit: "-",
    });

    expect(result.status).toBe("UNMAPPED");
    expect(result.definition).toBeUndefined();
  });
});
