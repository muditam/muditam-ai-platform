import type {
  ExtractedPage,
  ExtractionWarning,
  PositionedTextItem,
} from "../contracts/extracted-document.js";

export function assessPageQuality(
  pageNumber: number,
  items: PositionedTextItem[],
  imageObjects: number,
): ExtractedPage["quality"] {
  const text = items.map((item) => item.text).join(" ");
  const compactText = text.replace(/\s+/g, "");
  const alphanumericCharacters = (
    compactText.match(/[\p{L}\p{N}]/gu) ?? []
  ).length;
  const numericTokens = (
    text.match(/[<>≤≥]?\s*-?\d+(?:[.,]\d+)?/gu) ?? []
  ).length;
  const replacementCharacters = (text.match(/\uFFFD/gu) ?? []).length;
  const warnings: ExtractionWarning[] = [];
  let status: ExtractedPage["quality"]["status"] = "GOOD";

  if (compactText.length === 0) {
    if (imageObjects > 0) {
      status = "OCR_REQUIRED";
      warnings.push({
        code: "IMAGE_ONLY_PAGE",
        message: "The page contains image content but no extractable text.",
        pageNumber,
      });
    } else {
      status = "EMPTY";
      warnings.push({
        code: "NO_TEXT",
        message: "The page contains no extractable text.",
        pageNumber,
      });
    }
  } else if (alphanumericCharacters < 20 && imageObjects > 0) {
    status = "OCR_REQUIRED";
    warnings.push({
      code: "LOW_TEXT_CONTENT",
      message:
        "The page has too little meaningful text relative to its image content.",
      pageNumber,
    });
  } else if (alphanumericCharacters < 40) {
    status = "SUSPECT";
    warnings.push({
      code: "LOW_TEXT_CONTENT",
      message: "The page has unusually little extractable text.",
      pageNumber,
    });
  }

  if (
    replacementCharacters > 0 &&
    replacementCharacters / Math.max(1, compactText.length) > 0.005
  ) {
    status = status === "OCR_REQUIRED" ? status : "SUSPECT";
    warnings.push({
      code: "CORRUPTED_GLYPHS",
      message: "The extracted text contains suspicious replacement characters.",
      pageNumber,
    });
  }

  return {
    status,
    textCharacters: compactText.length,
    alphanumericCharacters,
    numericTokens,
    replacementCharacters,
    imageObjects,
    warnings,
  };
}
