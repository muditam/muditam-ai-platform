import {
  STRUCTURED_REPORT_SCHEMA_VERSION,
  structuredReportSchema,
  type Observation,
  type StructuredReport,
} from "../contracts/structured-report.js";
import type {
  ExtractedDocument,
  ExtractedPage,
  TextLine,
} from "../contracts/extracted-document.js";
import {
  detectColumnModel,
  nearestColumn,
  type ColumnModel,
} from "./column-model.js";
import { findBiomarker } from "../catalogue/biomarkers.js";

interface Columns {
  description: string;
  value: string;
  unit: string;
  referenceRange: string;
}

function lineColumns(
  page: ExtractedPage,
  line: TextLine,
  model: ColumnModel,
): Columns {
  const columns: Record<keyof Columns, string[]> = {
    description: [],
    value: [],
    unit: [],
    referenceRange: [],
  };
  const items = line.itemIds
    .map((id) => page.items.find((item) => item.id === id))
    .filter((item) => item !== undefined);

  for (const item of items) {
    const ratio = item.boundingBox.x / page.width;
    const key = nearestColumn(ratio, model.anchors);
    const tolerances: Record<keyof Columns, number> = {
      description: 0.2,
      value: 0.075,
      unit: 0.08,
      referenceRange: 0.12,
    };
    if (Math.abs(ratio - model.anchors[key]) > tolerances[key]) continue;
    columns[key].push(item.text.trim());
  }
  return {
    description: columns.description.filter(Boolean).join(" "),
    value: columns.value.filter(Boolean).join(" "),
    unit: columns.unit.filter(Boolean).join(" "),
    referenceRange: columns.referenceRange.filter(Boolean).join(" "),
  };
}

function parseFlag(value: string): {
  value: string;
  flag?: Observation["raw"]["flag"];
} {
  const match = value.match(/\s+(CH\*|CL\*|H\*|L\*)$/i);
  if (!match) return { value: value.trim() };
  const flags: Record<string, Observation["raw"]["flag"]> = {
    "H*": "H",
    "L*": "L",
    "CH*": "CRITICAL_HIGH",
    "CL*": "CRITICAL_LOW",
  };
  return {
    value: value.slice(0, match.index).trim(),
    flag: flags[match[1]?.toUpperCase() ?? ""],
  };
}

function numberValue(text: string): number | undefined {
  const normalized = text.replace(/,/g, "").trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return undefined;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

function parseValue(value: string): Observation["parsedValue"] {
  const inequality = value.match(/^(<=|>=|<|>)\s*(-?\d+(?:\.\d+)?)$/);
  if (inequality) {
    return {
      type: "INEQUALITY",
      comparator: inequality[1] as "<" | "<=" | ">" | ">=",
      numericValue: Number(inequality[2]),
    };
  }
  const range = value.match(
    /^(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)$/,
  );
  if (range) {
    return {
      type: "RANGE",
      lower: Number(range[1]),
      upper: Number(range[2]),
    };
  }
  const numeric = numberValue(value);
  if (numeric !== undefined) return { type: "NUMERIC", numericValue: numeric };
  return { type: "QUALITATIVE", text: value };
}

function looksLikeResultValue(value: string): boolean {
  return (
    /^(?:[<>]=?\s*)?-?\d/.test(value.trim()) ||
    /^(positive|negative|reactive|non-reactive|detected|not detected|present|absent|trace)$/i.test(
      value.trim(),
    )
  );
}

function isAnalyzerAppendix(page: ExtractedPage): boolean {
  const text = page.lines.map((line) => line.text).join("\n");
  return (
    /Patient Data\s+Analysis Data/i.test(text) &&
    /Peak Name.*Area.*Time/i.test(text)
  );
}

function startsInterpretiveTable(text: string): boolean {
  return /^(?:reference group\b|risk group\s+treatment goals\b|national lipid association recommendations\b|newer treatment goals\b)/i.test(
    text.trim(),
  );
}

function sourceFor(page: ExtractedPage, line: TextLine) {
  return {
    pageNumber: page.pageNumber,
    lineId: line.id,
    itemIds: line.itemIds,
    boundingBox: line.boundingBox,
  };
}

function headingType(
  page: ExtractedPage,
  line: TextLine,
): "PANEL" | "SECTION" | undefined {
  if (line.itemIds.length !== 1) return undefined;
  const item = page.items.find((candidate) => candidate.id === line.itemIds[0]);
  if (!item || item.fontSize < 8.8 || item.boundingBox.x >= 40) return undefined;
  if (/^(note|comment|interpretation|reference|clinical use)/i.test(line.text)) {
    return undefined;
  }
  return item.boundingBox.x < 28.5 ? "PANEL" : "SECTION";
}

function isMethodLine(
  page: ExtractedPage,
  line: TextLine,
  previous: Observation | undefined,
): boolean {
  if (!previous || previous.source.pageNumber !== page.pageNumber) return false;
  if (line.boundingBox.y - previous.source.boundingBox.y > 20) return false;
  const items = line.itemIds
    .map((id) => page.items.find((item) => item.id === id))
    .filter((item) => item !== undefined);
  return (
    items.length > 0 &&
    items.every(
      (item) => item.boundingBox.x / page.width < 0.44 && item.fontSize < 8.8,
    )
  );
}

export function structureReport(
  document: ExtractedDocument,
): StructuredReport {
  const columnModel = detectColumnModel(document);
  const panelMap = new Map<string, Observation[]>();
  const unclassifiedContent: StructuredReport["unclassifiedContent"] = [];
  let currentPanel = "Uncategorized";
  let currentSection: string | undefined;
  let previousObservation: Observation | undefined;
  let observationNumber = 0;
  let classifiedLineCount = 0;
  let insideInterpretiveTable = false;

  for (const page of document.pages) {
    if (isAnalyzerAppendix(page)) {
      for (const line of page.lines) {
        unclassifiedContent.push({
          text: line.text,
          source: sourceFor(page, line),
        });
      }
      previousObservation = undefined;
      continue;
    }

    for (const line of page.lines) {
      if (startsInterpretiveTable(line.text)) {
        insideInterpretiveTable = true;
        unclassifiedContent.push({
          text: line.text,
          source: sourceFor(page, line),
        });
        previousObservation = undefined;
        continue;
      }

      const prospectiveHeading = headingType(page, line);
      if (prospectiveHeading === "PANEL") insideInterpretiveTable = false;
      if (insideInterpretiveTable && !prospectiveHeading) {
        unclassifiedContent.push({
          text: line.text,
          source: sourceFor(page, line),
        });
        previousObservation = undefined;
        continue;
      }

      const columns = lineColumns(page, line, columnModel);
      if (/^eGFR\b/i.test(columns.description)) {
        const valueWithUnit = columns.value.match(
          /^(-?\d+(?:\.\d+)?)\s+(.+)$/,
        );
        if (valueWithUnit) {
          columns.value = valueWithUnit[1] ?? columns.value;
          columns.referenceRange = columns.unit;
          columns.unit = valueWithUnit[2] ?? "";
        }
      }
      const isCandidateRow =
        columns.description.length > 0 &&
        columns.value.length > 0 &&
        looksLikeResultValue(columns.value) &&
        (columns.referenceRange.length > 0 ||
          /^eGFR\b/i.test(columns.description) ||
          (columns.unit.length > 0 &&
            findBiomarker(columns.description) !== undefined));

      if (isCandidateRow) {
        const flagged = parseFlag(columns.value);
        observationNumber += 1;
        const raw: Observation["raw"] = {
          name: columns.description,
          value: flagged.value,
        };
        if (columns.unit) raw.unit = columns.unit;
        if (columns.referenceRange) {
          raw.referenceRange = columns.referenceRange;
        }
        if (flagged.flag) raw.flag = flagged.flag;
        const observation: Observation = {
          id: `obs-${String(observationNumber).padStart(4, "0")}`,
          raw,
          parsedValue: parseValue(flagged.value),
          source: sourceFor(page, line),
        };
        if (currentSection) observation.section = currentSection;
        const panel = panelMap.get(currentPanel) ?? [];
        panel.push(observation);
        panelMap.set(currentPanel, panel);
        previousObservation = observation;
        classifiedLineCount += 1;
        continue;
      }

      if (isMethodLine(page, line, previousObservation)) {
        const observation = previousObservation;
        if (observation) observation.raw.method = line.text;
        classifiedLineCount += 1;
        continue;
      }

      const heading = prospectiveHeading;
      if (heading === "PANEL") {
        currentPanel = line.text;
        currentSection = undefined;
        previousObservation = undefined;
        classifiedLineCount += 1;
        continue;
      }
      if (heading === "SECTION") {
        currentSection = line.text;
        previousObservation = undefined;
        classifiedLineCount += 1;
        continue;
      }

      unclassifiedContent.push({
        text: line.text,
        source: sourceFor(page, line),
      });
      previousObservation = undefined;
    }
  }

  const panels = [...panelMap.entries()]
    .map(([name, observations]) => ({ name, observations }))
    .filter((panel) => panel.observations.length > 0);
  const result: StructuredReport = {
    schemaVersion: STRUCTURED_REPORT_SCHEMA_VERSION,
    documentId: document.documentId,
    sourceExtractionSchemaVersion: document.schemaVersion,
    status: unclassifiedContent.length > 0 ? "PARTIAL" : "STRUCTURED",
    layoutAnalysis: columnModel,
    panels,
    unclassifiedContent,
    statistics: {
      observationCount: observationNumber,
      classifiedLineCount,
      unclassifiedLineCount: unclassifiedContent.length,
    },
  };
  return structuredReportSchema.parse(result);
}
