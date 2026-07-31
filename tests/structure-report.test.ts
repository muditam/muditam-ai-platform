import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { extractPdf, structureReport } from "../src/index.js";

async function reportWithRangeLessKnownMarker(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([600, 800]);
  page.drawText("Investigation", { x: 40, y: 760, size: 10, font });
  page.drawText("Result", { x: 260, y: 760, size: 10, font });
  page.drawText("Unit", { x: 380, y: 760, size: 10, font });
  page.drawText("Reference Range", { x: 490, y: 760, size: 10, font });
  page.drawText("Average Estimated Glucose", {
    x: 40,
    y: 720,
    size: 10,
    font,
  });
  page.drawText("154.20", { x: 260, y: 720, size: 10, font });
  page.drawText("mg/dL", { x: 380, y: 720, size: 10, font });
  return document.save();
}

describe("structureReport", () => {
  it("retains a known biomarker with value and unit when no range is printed", async () => {
    const extracted = await extractPdf(
      await reportWithRangeLessKnownMarker(),
    );
    const structured = structureReport(extracted);
    const observation = structured.panels
      .flatMap((panel) => panel.observations)
      .find(
        (candidate) => candidate.raw.name === "Average Estimated Glucose",
      );

    expect(observation?.raw).toMatchObject({
      value: "154.20",
      unit: "mg/dL",
    });
    expect(observation?.raw.referenceRange).toBeUndefined();
  });
});
