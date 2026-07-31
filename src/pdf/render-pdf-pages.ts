import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { ExtractionError } from "../errors/extraction-error.js";

const require = createRequire(import.meta.url);
const pdfjsDirectory = dirname(require.resolve("pdfjs-dist/package.json"));
const standardFontDataUrl = `${join(pdfjsDirectory, "standard_fonts")}${sep}`;

export interface RenderedPdfPage {
  pageNumber: number;
  pngBytes: Uint8Array;
  width: number;
  height: number;
}

export async function renderPdfPages(
  bytes: Uint8Array,
  pageNumbers: number[],
  scale = 2.5,
): Promise<RenderedPdfPage[]> {
  const loadingTask = getDocument({
    data: bytes.slice(),
    standardFontDataUrl,
    useSystemFonts: false,
  });
  try {
    const document = await loadingTask.promise;
    const rendered: RenderedPdfPage[] = [];
    for (const pageNumber of pageNumbers) {
      if (pageNumber < 1 || pageNumber > document.numPages) {
        throw new ExtractionError(
          "PDF_PARSE_FAILED",
          `Cannot render missing PDF page ${pageNumber}.`,
        );
      }
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      await page.render({
        canvas: canvas as never,
        viewport,
      }).promise;
      rendered.push({
        pageNumber,
        pngBytes: new Uint8Array(await canvas.encode("png")),
        width: canvas.width,
        height: canvas.height,
      });
      page.cleanup();
    }
    return rendered;
  } finally {
    await loadingTask.destroy();
  }
}
