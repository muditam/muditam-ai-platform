import type {
  ExtractedDocument,
  PositionedTextItem,
} from "../contracts/extracted-document.js";

export interface ColumnAnchors {
  description: number;
  value: number;
  unit: number;
  referenceRange: number;
}

export interface ColumnModel {
  strategy: "HEADER" | "CLUSTERED" | "FALLBACK";
  confidence: number;
  anchors: ColumnAnchors;
  evidenceRowCount: number;
}

interface Point {
  ratio: number;
  weight: number;
}

const FALLBACK_ANCHORS: ColumnAnchors = {
  description: 0.05,
  value: 0.485,
  unit: 0.637,
  referenceRange: 0.78,
};

function isResultLike(text: string): boolean {
  return /^(?:[<>]=?\s*)?-?\d[\d,.]*(?:\s*(?:H|L|CH|CL)\*)?$/i.test(
    text.trim(),
  );
}

function isUnitLike(text: string): boolean {
  return /^(?:%|[-–—]|(?:10\^?\d+\/)?[µμu]?[glmfnp]?(?:g|l|L|dL|mol|IU|U|Eq|cells)(?:\/[^\s]+)?|ratio)$/i.test(
    text.trim(),
  );
}

function clusters(points: Point[], tolerance = 0.025) {
  const sorted = [...points].sort((a, b) => a.ratio - b.ratio);
  const result: Array<{ center: number; weight: number; count: number }> = [];
  for (const point of sorted) {
    const cluster = result.findLast(
      (candidate) => Math.abs(candidate.center - point.ratio) <= tolerance,
    );
    if (!cluster) {
      result.push({ center: point.ratio, weight: point.weight, count: 1 });
      continue;
    }
    const totalWeight = cluster.weight + point.weight;
    cluster.center =
      (cluster.center * cluster.weight + point.ratio * point.weight) /
      totalWeight;
    cluster.weight = totalWeight;
    cluster.count += 1;
  }
  return result;
}

function strongest(
  points: Point[],
  minimum: number,
  maximum: number,
): { center: number; count: number } | undefined {
  return clusters(
    points.filter((point) => point.ratio >= minimum && point.ratio <= maximum),
  )
    .filter((cluster) => cluster.count >= 2)
    .sort((a, b) => b.weight - a.weight)[0];
}

function ratio(item: PositionedTextItem, width: number): number {
  return item.boundingBox.x / width;
}

function headerRole(text: string): keyof ColumnAnchors | undefined {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (/^(?:test|test name|investigation|parameter|description|analyte)$/.test(normalized)) {
    return "description";
  }
  if (/^(?:result|value|observed value|test result)$/.test(normalized)) {
    return "value";
  }
  if (/^units?$/.test(normalized)) return "unit";
  if (
    /^(?:reference range|reference interval|biological range|normal range)$/.test(
      normalized,
    )
  ) {
    return "referenceRange";
  }
  return undefined;
}

function detectHeaderAnchors(
  document: ExtractedDocument,
): ColumnAnchors | undefined {
  for (const page of document.pages) {
    for (const line of page.lines) {
      const found = new Map<keyof ColumnAnchors, number>();
      for (const id of line.itemIds) {
        const item = page.items.find((candidate) => candidate.id === id);
        if (!item) continue;
        const role = headerRole(item.text);
        if (role) found.set(role, ratio(item, page.width));
      }
      if (
        found.has("description") &&
        found.has("value") &&
        found.has("unit") &&
        found.has("referenceRange")
      ) {
        const anchors = Object.fromEntries(found) as unknown as ColumnAnchors;
        if (
          anchors.description < anchors.value &&
          anchors.value < anchors.unit &&
          anchors.unit < anchors.referenceRange
        ) {
          return anchors;
        }
      }
    }
  }
  return undefined;
}

export function detectColumnModel(
  document: ExtractedDocument,
): ColumnModel {
  const headerAnchors = detectHeaderAnchors(document);
  if (headerAnchors) {
    return {
      strategy: "HEADER",
      confidence: 0.98,
      anchors: headerAnchors,
      evidenceRowCount: 1,
    };
  }

  const descriptions: Point[] = [];
  const results: Point[] = [];
  const units: Point[] = [];
  const references: Point[] = [];
  let evidenceRowCount = 0;

  for (const page of document.pages) {
    for (const line of page.lines) {
      const items = line.itemIds
        .map((id) => page.items.find((item) => item.id === id))
        .filter((item) => item !== undefined);
      if (items.length < 3 || items.length > 7) continue;
      const resultItems = items.filter(
        (item) =>
          isResultLike(item.text) &&
          ratio(item, page.width) >= 0.25 &&
          ratio(item, page.width) <= 0.7,
      );
      if (resultItems.length === 0) continue;
      const first = items[0];
      if (!first || ratio(first, page.width) >= 0.35) continue;

      evidenceRowCount += 1;
      descriptions.push({ ratio: ratio(first, page.width), weight: 2 });
      for (const item of resultItems) {
        results.push({ ratio: ratio(item, page.width), weight: 3 });
      }
      for (const item of items) {
        const itemRatio = ratio(item, page.width);
        if (isUnitLike(item.text) && itemRatio > 0.45) {
          units.push({ ratio: itemRatio, weight: 2 });
        }
        if (
          itemRatio > 0.68 &&
          (/\d/.test(item.text) || /refer|normal|desirable|deficient/i.test(item.text))
        ) {
          references.push({ ratio: itemRatio, weight: 2 });
        }
      }
    }
  }

  const description = strongest(descriptions, 0, 0.35);
  const value = strongest(results, 0.25, 0.7);
  const unit = strongest(units, (value?.center ?? 0.4) + 0.04, 0.82);
  const referenceRange = strongest(
    references,
    (unit?.center ?? value?.center ?? 0.55) + 0.04,
    0.98,
  );
  const ordered =
    description &&
    value &&
    unit &&
    referenceRange &&
    description.center < value.center &&
    value.center < unit.center &&
    unit.center < referenceRange.center;

  if (!ordered || evidenceRowCount < 4) {
    return {
      strategy: "FALLBACK",
      confidence: 0.35,
      anchors: FALLBACK_ANCHORS,
      evidenceRowCount,
    };
  }

  const evidenceConfidence = Math.min(1, evidenceRowCount / 20);
  const supportConfidence = Math.min(
    1,
    Math.min(description.count, value.count, unit.count, referenceRange.count) /
      8,
  );
  return {
    strategy: "CLUSTERED",
    confidence: Number(
      Math.min(
        0.95,
        0.55 + evidenceConfidence * 0.25 + supportConfidence * 0.2,
      ).toFixed(3),
    ),
    anchors: {
      description: description.center,
      value: value.center,
      unit: unit.center,
      referenceRange: referenceRange.center,
    },
    evidenceRowCount,
  };
}

export function nearestColumn(
  ratio: number,
  anchors: ColumnAnchors,
): keyof ColumnAnchors {
  return (
    Object.entries(anchors) as Array<[keyof ColumnAnchors, number]>
  ).sort((a, b) => Math.abs(a[1] - ratio) - Math.abs(b[1] - ratio))[0]![0];
}
