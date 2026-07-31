import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { detectColumnModel, extractPdf } from "../src/index.js";

async function tablePdf(
  rowCount: number,
  includeHeader = false,
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([600, 800]);
  if (includeHeader) {
    page.drawText("Investigation", { x: 60, y: 760, size: 10, font });
    page.drawText("Result", { x: 270, y: 760, size: 10, font });
    page.drawText("Unit", { x: 390, y: 760, size: 10, font });
    page.drawText("Reference Range", { x: 500, y: 760, size: 10, font });
  }
  for (let index = 0; index < rowCount; index += 1) {
    const y = 720 - index * 24;
    page.drawText(`Marker ${index + 1}`, { x: 60, y, size: 10, font });
    page.drawText(String(10 + index), { x: 270, y, size: 10, font });
    page.drawText("mg/dL", { x: 390, y, size: 10, font });
    page.drawText("5 - 20", { x: 500, y, size: 10, font });
  }
  return document.save();
}

describe("detectColumnModel", () => {
  it("uses explicit table headers when all semantic columns are available", async () => {
    const document = await extractPdf(await tablePdf(2, true));
    const model = detectColumnModel(document);

    expect(model.strategy).toBe("HEADER");
    expect(model.confidence).toBe(0.98);
    expect(model.anchors.value).toBeCloseTo(0.45, 2);
  });

  it("learns repeated table anchors instead of fixed positions", async () => {
    const document = await extractPdf(await tablePdf(6));
    const model = detectColumnModel(document);

    expect(model.strategy).toBe("CLUSTERED");
    expect(model.evidenceRowCount).toBe(6);
    expect(model.anchors.description).toBeCloseTo(0.1, 2);
    expect(model.anchors.value).toBeCloseTo(0.45, 2);
    expect(model.anchors.unit).toBeCloseTo(0.65, 2);
    expect(model.anchors.referenceRange).toBeCloseTo(0.833, 2);
    expect(model.confidence).toBeGreaterThan(0.7);
    expect(model.confidence).toBeLessThan(1);
  });

  it("uses a declared low-confidence fallback when evidence is insufficient", async () => {
    const document = await extractPdf(await tablePdf(1));
    const model = detectColumnModel(document);

    expect(model.strategy).toBe("FALLBACK");
    expect(model.confidence).toBe(0.35);
  });
});
