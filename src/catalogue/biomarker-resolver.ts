import {
  biomarkerCatalogue,
  findBiomarker,
  normalizeBiomarkerName,
  type BiomarkerDefinition,
} from "./biomarkers.js";

export type MappingStatus =
  | "MAPPED"
  | "POSSIBLE_MATCH"
  | "AMBIGUOUS"
  | "UNMAPPED";

export type MappingMethod =
  | "EXACT_ALIAS"
  | "TOKEN_SIGNATURE"
  | "NONE";

export interface BiomarkerResolution {
  status: MappingStatus;
  method: MappingMethod;
  confidence: number;
  definition?: BiomarkerDefinition;
  suggestedCanonicalCode?: string;
  evidence: string[];
  alternatives: Array<{ canonicalCode: string; confidence: number }>;
}

export interface ResolveBiomarkerInput {
  rawName: string;
  panel?: string;
  unit?: string;
}

const removableTokens = new Set([
  "serum",
  "plasma",
  "test",
  "assay",
  "level",
  "levels",
  "calculated",
  "direct",
]);

function tokens(name: string): Set<string> {
  const expanded = normalizeBiomarkerName(name)
    .replace(/\bhdl c\b/g, "hdl cholesterol")
    .replace(/\bldl c\b/g, "ldl cholesterol")
    .replace(/\bvldl c\b/g, "vldl cholesterol")
    .replace(/\bhb a1c\b/g, "hba1c");
  return new Set(
    expanded
      .split(" ")
      .filter(Boolean)
      .filter((token) => !removableTokens.has(token)),
  );
}

function comparableUnit(unit: string): string {
  const comparable = unit
    .toLowerCase()
    .replace(/[µμ]/g, "u")
    .replace(/\^/g, "")
    .replace(/²/g, "2")
    .replace(/\s+/g, "")
    .replace(/^gm\//, "g/")
    .replace(/mm\/1sthour/g, "mm/hr");
  if (comparable === "miu/l" || comparable === "uiu/ml") return "uiu/ml";
  return comparable;
}

function tokenScore(raw: Set<string>, alias: Set<string>): number {
  if (raw.size === 0 || alias.size === 0) return 0;
  const intersection = [...alias].filter((token) => raw.has(token)).length;
  if (intersection !== alias.size) return 0;
  const extras = Math.max(0, raw.size - alias.size);
  return Math.max(0, 0.98 - extras * 0.025);
}

function candidateScore(
  rawTokens: Set<string>,
  definition: BiomarkerDefinition,
): number {
  return Math.max(
    ...definition.aliases.map((alias) => tokenScore(rawTokens, tokens(alias))),
  );
}

function panelSupports(panel: string | undefined, definition: BiomarkerDefinition) {
  if (!panel) return false;
  const normalized = normalizeBiomarkerName(panel);
  const expected = definition.panel.toLowerCase();
  const synonyms: Record<string, string[]> = {
    diabetes: ["diabetes", "hba1c", "glucose", "sugar"],
    liver: ["liver", "lft", "hepatic"],
    kidney: ["kidney", "kft", "renal"],
    lipid: ["lipid", "cholesterol"],
    inflammation: ["inflammation", "esr", "crp"],
    cbc: ["cbc", "blood count", "hematology"],
    thyroid: ["thyroid"],
    vitamin: ["vitamin"],
  };
  return (synonyms[expected] ?? [expected]).some((word) =>
    normalized.includes(word),
  );
}

export function resolveBiomarker(
  input: ResolveBiomarkerInput,
): BiomarkerResolution {
  const exact = findBiomarker(input.rawName);
  if (exact) {
    const evidence = [`Approved alias: "${input.rawName}"`];
    if (panelSupports(input.panel, exact)) {
      evidence.push(`Compatible panel: ${input.panel}`);
    }
    if (
      input.unit &&
      exact.standardUnit &&
      comparableUnit(input.unit) === comparableUnit(exact.standardUnit)
    ) {
      evidence.push(`Compatible unit: ${input.unit}`);
    }
    return {
      status: "MAPPED",
      method: "EXACT_ALIAS",
      confidence: 1,
      definition: exact,
      evidence,
      alternatives: [],
    };
  }

  const rawTokens = tokens(input.rawName);
  const candidates = biomarkerCatalogue
    .map((definition) => {
      let confidence = candidateScore(rawTokens, definition);
      const evidence: string[] = [];
      if (confidence > 0) {
        evidence.push("Medical identity tokens match regardless of word order");
      }
      if (confidence > 0 && panelSupports(input.panel, definition)) {
        confidence = Math.min(0.99, confidence + 0.02);
        evidence.push(`Compatible panel: ${input.panel}`);
      }
      if (
        confidence > 0 &&
        input.panel &&
        normalizeBiomarkerName(input.panel).includes("urine") &&
        definition.panel !== "URINE"
      ) {
        confidence -= 0.4;
        evidence.push(`Specimen conflict with panel: ${input.panel}`);
      }
      if (confidence > 0 && input.unit && definition.standardUnit) {
        if (
          comparableUnit(input.unit) === comparableUnit(definition.standardUnit)
        ) {
          confidence = Math.min(0.99, confidence + 0.01);
          evidence.push(`Compatible unit: ${input.unit}`);
        } else {
          confidence -= 0.18;
          evidence.push(
            `Unit conflict: expected ${definition.standardUnit}, received ${input.unit}`,
          );
        }
      }
      return { definition, confidence, evidence };
    })
    .filter((candidate) => candidate.confidence >= 0.7)
    .sort((a, b) => b.confidence - a.confidence);

  const best = candidates[0];
  if (!best) {
    return {
      status: "UNMAPPED",
      method: "NONE",
      confidence: 0,
      evidence: ["No safe canonical candidate"],
      alternatives: [],
    };
  }

  const alternatives = candidates.slice(1, 4).map((candidate) => ({
    canonicalCode: candidate.definition.canonicalCode,
    confidence: Number(candidate.confidence.toFixed(3)),
  }));
  const second = candidates[1];
  const margin = best.confidence - (second?.confidence ?? 0);
  const roundedConfidence = Number(best.confidence.toFixed(3));
  if (second && margin < 0.08) {
    return {
      status: "AMBIGUOUS",
      method: "TOKEN_SIGNATURE",
      confidence: roundedConfidence,
      suggestedCanonicalCode: best.definition.canonicalCode,
      evidence: best.evidence,
      alternatives,
    };
  }
  if (best.confidence >= 0.9) {
    return {
      status: "MAPPED",
      method: "TOKEN_SIGNATURE",
      confidence: roundedConfidence,
      definition: best.definition,
      evidence: best.evidence,
      alternatives,
    };
  }
  return {
    status: "POSSIBLE_MATCH",
    method: "TOKEN_SIGNATURE",
    confidence: roundedConfidence,
    suggestedCanonicalCode: best.definition.canonicalCode,
    evidence: best.evidence,
    alternatives,
  };
}
