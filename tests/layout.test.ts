import { describe, expect, it } from "vitest";
import type { PositionedTextItem } from "../src/index.js";
import { reconstructLines } from "../src/pdf/layout.js";

function item(
  id: string,
  text: string,
  x: number,
  baselineY: number,
  width = 30,
): PositionedTextItem {
  return {
    id,
    text,
    boundingBox: { x, y: baselineY - 10, width, height: 10 },
    baselineY,
    fontName: "F1",
    fontSize: 10,
    direction: "ltr",
    hasEndOfLine: false,
  };
}

describe("reconstructLines", () => {
  it("groups same-baseline table cells and orders them left to right", () => {
    const lines = reconstructLines(
      [
        item("value", "6.2", 220, 100, 16),
        item("range", "4.0 - 5.6", 390, 100, 50),
        item("name", "HbA1c", 40, 100, 40),
        item("unit", "%", 310, 100, 8),
      ],
      1,
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe("HbA1c 6.2 % 4.0 - 5.6");
    expect(lines[0]?.itemIds).toEqual(["name", "value", "unit", "range"]);
  });

  it("keeps vertically separated rows distinct", () => {
    const lines = reconstructLines(
      [
        item("a", "Hemoglobin", 40, 100),
        item("b", "12.8", 220, 100),
        item("c", "RBC Count", 40, 125),
        item("d", "4.6", 220, 125),
      ],
      2,
    );

    expect(lines.map((line) => line.text)).toEqual([
      "Hemoglobin 12.8",
      "RBC Count 4.6",
    ]);
    expect(lines.map((line) => line.id)).toEqual(["p2-l1", "p2-l2"]);
  });
});
