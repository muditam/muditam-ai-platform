import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  EXTRACTION_SCHEMA_VERSION,
  ExtractionError,
  extractPdf,
  extractedDocumentSchema,
  renderPdfPages,
} from "../src/index.js";

async function createTextPdf(pageCount = 1): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.setTitle("Synthetic laboratory report");
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < pageCount; index += 1) {
    const page = document.addPage([595, 842]);
    page.drawText("Complete Blood Count Laboratory Report", {
      x: 40,
      y: 780,
      size: 12,
      font,
    });
    page.drawText("HbA1c", { x: 40, y: 720, size: 10, font });
    page.drawText("6.2", { x: 220, y: 720, size: 10, font });
    page.drawText("%", { x: 310, y: 720, size: 10, font });
    page.drawText("4.0 - 5.6", { x: 390, y: 720, size: 10, font });
  }
  return document.save();
}

async function createImageOnlyPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([595, 842]);
  const png = await document.embedPng(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  );
  page.drawImage(png, {
    x: 0,
    y: 0,
    width: 595,
    height: 842,
    opacity: 1,
  });
  return document.save();
}

async function createMixedPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const textPage = document.addPage([595, 842]);
  textPage.drawText("Synthetic laboratory report with usable digital text", {
    x: 40,
    y: 780,
    size: 12,
    font,
    color: rgb(0, 0, 0),
  });
  const imagePage = document.addPage([595, 842]);
  const png = await document.embedPng(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  );
  imagePage.drawImage(png, { x: 0, y: 0, width: 595, height: 842 });
  return document.save();
}

describe("extractPdf", () => {
  it("extracts positioned items, reconstructed lines, metadata and quality", async () => {
    const bytes = await createTextPdf();
    const result = await extractPdf(bytes, {
      fileName: "synthetic.pdf",
      documentId: "doc-test",
    });

    expect(result.schemaVersion).toBe(EXTRACTION_SCHEMA_VERSION);
    expect(result.documentId).toBe("doc-test");
    expect(result.source.fileName).toBe("synthetic.pdf");
    expect(result.source.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.metadata.title).toBe("Synthetic laboratory report");
    expect(result.quality.status).toBe("EXTRACTED");
    expect(result.quality.pagesExtracted).toBe(1);
    expect(result.pages[0]?.plainText).toContain("HbA1c 6.2 % 4.0 - 5.6");
    expect(result.pages[0]?.items.some((item) => item.text === "6.2")).toBe(
      true,
    );
    expect(result.pages[0]?.items.every((item) => item.boundingBox.y >= 0)).toBe(
      true,
    );
    expect(extractedDocumentSchema.safeParse(result).success).toBe(true);
  });

  it("classifies an image-only page as requiring OCR without invoking OCR", async () => {
    const bytes = await createImageOnlyPdf();
    const result = await extractPdf(bytes);

    expect(result.quality.status).toBe("OCR_REQUIRED");
    expect(result.quality.pagesRequiringOcr).toEqual([1]);
    expect(result.pages[0]?.quality.status).toBe("OCR_REQUIRED");
    expect(result.pages[0]?.quality.imageObjects).toBeGreaterThan(0);
    expect(result.pages[0]?.items).toEqual([]);

    const rendered = await renderPdfPages(bytes, [1]);
    expect(rendered).toHaveLength(1);
    expect(rendered[0]?.pageNumber).toBe(1);
    expect(rendered[0]?.width).toBeGreaterThan(1_000);
    expect(rendered[0]?.height).toBeGreaterThan(2_000);
    expect(rendered[0]?.pngBytes.subarray(0, 8)).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  it("reports mixed digital and image-only pages as partial extraction", async () => {
    const result = await extractPdf(await createMixedPdf());

    expect(result.quality.status).toBe("PARTIAL");
    expect(result.quality.pagesExtracted).toBe(1);
    expect(result.quality.pagesRequiringOcr).toEqual([2]);
    expect(result.quality.warnings).toContainEqual(
      expect.objectContaining({ code: "MIXED_EXTRACTION_QUALITY" }),
    );
  });

  it("rejects non-PDF content before parsing", async () => {
    await expect(
      extractPdf(new TextEncoder().encode("not a PDF")),
    ).rejects.toMatchObject({
      name: "ExtractionError",
      code: "INVALID_PDF",
    } satisfies Partial<ExtractionError>);
  });

  it("enforces byte and page limits", async () => {
    const bytes = await createTextPdf(2);

    await expect(extractPdf(bytes, { maxBytes: 10 })).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
    });
    await expect(extractPdf(bytes, { maxPages: 1 })).rejects.toMatchObject({
      code: "PAGE_LIMIT_EXCEEDED",
    });
  });
});
