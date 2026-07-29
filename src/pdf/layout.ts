import type {
  BoundingBox,
  PositionedTextItem,
  TextLine,
} from "../contracts/extracted-document.js";

interface LineGroup {
  baselineY: number;
  items: PositionedTextItem[];
}

function unionBoundingBoxes(items: PositionedTextItem[]): BoundingBox {
  const left = Math.min(...items.map((item) => item.boundingBox.x));
  const top = Math.min(...items.map((item) => item.boundingBox.y));
  const right = Math.max(
    ...items.map((item) => item.boundingBox.x + item.boundingBox.width),
  );
  const bottom = Math.max(
    ...items.map((item) => item.boundingBox.y + item.boundingBox.height),
  );
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function joinLineItems(items: PositionedTextItem[]): string {
  let output = "";
  for (const [index, item] of items.entries()) {
    if (index === 0) {
      output = item.text;
      continue;
    }
    const previous = items[index - 1];
    if (!previous) continue;
    const gap =
      item.boundingBox.x -
      (previous.boundingBox.x + previous.boundingBox.width);
    const spacingThreshold = Math.max(
      0.75,
      Math.min(previous.fontSize, item.fontSize) * 0.12,
    );
    const needsSpace =
      !output.endsWith(" ") &&
      !item.text.startsWith(" ") &&
      gap > spacingThreshold;
    output += `${needsSpace ? " " : ""}${item.text}`;
  }
  return output.replace(/[ \t]+/g, " ").trim();
}

export function reconstructLines(
  items: PositionedTextItem[],
  pageNumber: number,
): TextLine[] {
  const sorted = items
    .filter((item) => item.text.trim().length > 0)
    .toSorted(
      (left, right) =>
        left.baselineY - right.baselineY ||
        left.boundingBox.x - right.boundingBox.x,
    );
  const groups: LineGroup[] = [];

  for (const item of sorted) {
    let bestGroup: LineGroup | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const group of groups) {
      const representativeSize = Math.max(
        item.fontSize,
        ...group.items.map((candidate) => candidate.fontSize),
      );
      const tolerance = Math.max(1.5, Math.min(6, representativeSize * 0.4));
      const distance = Math.abs(group.baselineY - item.baselineY);
      if (distance <= tolerance && distance < bestDistance) {
        bestGroup = group;
        bestDistance = distance;
      }
    }
    if (bestGroup) {
      bestGroup.items.push(item);
      bestGroup.baselineY =
        bestGroup.items.reduce((sum, value) => sum + value.baselineY, 0) /
        bestGroup.items.length;
    } else {
      groups.push({ baselineY: item.baselineY, items: [item] });
    }
  }

  return groups
    .toSorted((left, right) => left.baselineY - right.baselineY)
    .map((group, index) => {
      const lineItems = group.items.toSorted(
        (left, right) => left.boundingBox.x - right.boundingBox.x,
      );
      return {
        id: `p${pageNumber}-l${index + 1}`,
        text: joinLineItems(lineItems),
        itemIds: lineItems.map((item) => item.id),
        boundingBox: unionBoundingBoxes(lineItems),
      };
    })
    .filter((line) => line.text.length > 0);
}
