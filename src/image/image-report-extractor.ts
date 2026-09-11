import { createHash } from "node:crypto";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import {
  IMAGE_EXTRACTION_SCHEMA_VERSION,
  imageExtractionPayloadSchema,
  type ImageExtractionPayload,
} from "../contracts/image-extraction.js";
import {
  STRUCTURED_REPORT_SCHEMA_VERSION,
  structuredReportSchema,
  type Observation,
  type StructuredReport,
} from "../contracts/structured-report.js";
import { ExtractionError } from "../errors/extraction-error.js";

export type SupportedImageMimeType = "image/jpeg" | "image/png";

export interface ExtractImageInput {
  bytes: Uint8Array;
  fileName: string;
  mimeType: SupportedImageMimeType;
  sourcePageNumber?: number;
}

export interface ImageObservationExtractor {
  extract(input: ExtractImageInput): Promise<ImageExtractionPayload>;
}

export interface OpenAIImageExtractorOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  client?: OpenAI;
}

const EXTRACTION_PROMPT = [
  "Extract only visibly printed patient-result rows from this blood-test report image, or the current reading shown on a digital glucometer display.",
  "For a glucometer photo, read only the large primary number inside the device's LCD/display and return one observation named Blood glucose.",
  "Ignore every number outside the glucometer display, including packaging, advertisements, posters, captions, dates, times, historical readings, targets, ranges, and example values.",
  "Return the printed test name, result value, unit, reference range, flag, method, and confidence.",
  "Do not diagnose, interpret, calculate, convert units, infer missing values, or invent reference ranges.",
  "Do not assign canonical biomarker codes.",
  "Do not treat explanatory text, reference-only tables, targets, or example ranges as patient results.",
  "Preserve inequality signs and qualitative values exactly.",
  "Treat a clearly visible glucometer reading as a supported blood-result image; otherwise set isBloodReport=false when this is not a blood-test report or glucometer reading.",
  "Use confidence below 0.85 for blurry, cropped, ambiguous, or partially obscured rows.",
  "Use quality=UNREADABLE when reliable patient results cannot be read.",
].join("\n");

export class OpenAIImageObservationExtractor
  implements ImageObservationExtractor
{
  readonly #client: OpenAI;
  readonly #model: string;
  readonly #timeoutMs: number;

  constructor(options: OpenAIImageExtractorOptions) {
    this.#client =
      options.client ??
      new OpenAI({
        apiKey: options.apiKey,
        timeout: options.timeoutMs ?? 120_000,
        maxRetries: 0,
      });
    this.#model =
      options.model ?? process.env.MUDITAM_OPENAI_VISION_MODEL ?? "gpt-5.6-luna";
    this.#timeoutMs = options.timeoutMs ?? 120_000;
  }

  async extract(input: ExtractImageInput): Promise<ImageExtractionPayload> {
    const base64 = Buffer.from(input.bytes).toString("base64");
    try {
      const response = await this.#client.responses.parse(
        {
          model: this.#model,
          store: false,
          max_output_tokens: 8_000,
          input: [
            { role: "system", content: EXTRACTION_PROMPT },
            {
              role: "user",
              content: [
                {
                  type: "input_image",
                  image_url: `data:${input.mimeType};base64,${base64}`,
                  detail: "high",
                },
                {
                  type: "input_text",
                  text: "Extract the patient-result rows into the required schema.",
                },
              ],
            },
          ],
          text: {
            format: zodTextFormat(
              imageExtractionPayloadSchema,
              "blood_report_image_extraction",
            ),
          },
        },
        { timeout: this.#timeoutMs },
      );
      if (response.output_parsed === null) {
        throw new ExtractionError(
          "VISION_INVALID_OUTPUT",
          "OpenAI did not return a valid image extraction payload.",
        );
      }
      return imageExtractionPayloadSchema.parse(response.output_parsed);
    } catch (error) {
      if (error instanceof ExtractionError) throw error;
      throw new ExtractionError(
        "VISION_PROVIDER_ERROR",
        "OpenAI image extraction failed.",
        undefined,
        { cause: error },
      );
    }
  }
}

function validateImage(bytes: Uint8Array, mimeType: SupportedImageMimeType): void {
  const isJpeg =
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const isPng = pngSignature.every((value, index) => bytes[index] === value);
  if (
    bytes.byteLength === 0 ||
    (mimeType === "image/jpeg" && !isJpeg) ||
    (mimeType === "image/png" && !isPng)
  ) {
    throw new ExtractionError(
      "INVALID_IMAGE",
      "The uploaded image content does not match its declared type.",
    );
  }
}

function parsedValue(value: string): Observation["parsedValue"] {
  const normalized = value.replace(/,/g, "").trim();
  const inequality = normalized.match(/^(<=|>=|<|>)\s*(-?\d+(?:\.\d+)?)$/);
  if (inequality) {
    return {
      type: "INEQUALITY",
      comparator: inequality[1] as "<" | "<=" | ">" | ">=",
      numericValue: Number(inequality[2]),
    };
  }
  const range = normalized.match(
    /^(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)$/,
  );
  if (range) {
    return {
      type: "RANGE",
      lower: Number(range[1]),
      upper: Number(range[2]),
    };
  }
  if (/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    return { type: "NUMERIC", numericValue: Number(normalized) };
  }
  return { type: "QUALITATIVE", text: value.trim() };
}

function normalizedFlag(
  flag: string | null,
): Observation["raw"]["flag"] | undefined {
  if (!flag) return undefined;
  const normalized = flag.trim().toUpperCase().replace(/\*/g, "");
  if (["H", "HIGH"].includes(normalized)) return "H";
  if (["L", "LOW"].includes(normalized)) return "L";
  if (["CH", "CRITICAL HIGH", "CRITICAL_HIGH"].includes(normalized)) {
    return "CRITICAL_HIGH";
  }
  if (["CL", "CRITICAL LOW", "CRITICAL_LOW"].includes(normalized)) {
    return "CRITICAL_LOW";
  }
  return undefined;
}

export async function extractImageReport(
  input: ExtractImageInput,
  extractor: ImageObservationExtractor,
): Promise<StructuredReport> {
  validateImage(input.bytes, input.mimeType);
  const payload = await extractor.extract(input);
  if (!payload.document.isBloodReport) {
    throw new ExtractionError(
      "NOT_A_BLOOD_REPORT",
      "The uploaded image was not recognized as a blood-test report.",
    );
  }
  const sourcePageNumber = input.sourcePageNumber ?? 1;
  const readableObservations =
    payload.document.quality === "UNREADABLE" ? [] : payload.observations;

  const observations: Observation[] = readableObservations.map((item, index) => {
    const raw: Observation["raw"] = {
      name: item.rawName.trim(),
      value: item.rawValue.trim(),
    };
    if (item.unit?.trim()) raw.unit = item.unit.trim();
    if (item.referenceRange?.trim()) {
      raw.referenceRange = item.referenceRange.trim();
    }
    const flag = normalizedFlag(item.rawFlag);
    if (flag) raw.flag = flag;
    if (item.method?.trim()) raw.method = item.method.trim();
    return {
      id: `vision-p${sourcePageNumber}-obs-${String(index + 1).padStart(4, "0")}`,
      raw,
      parsedValue: parsedValue(raw.value),
      source: {
        pageNumber: sourcePageNumber,
        lineId: `vision-p${sourcePageNumber}-line-${index + 1}`,
        itemIds: [`vision-p${sourcePageNumber}-item-${index + 1}`],
        boundingBox: { x: 0, y: index, width: 0, height: 0 },
        extractionMethod: "OPENAI_VISION",
        extractionConfidence: item.confidence,
      },
    };
  });
  const averageConfidence =
    observations.length === 0
      ? 0
      : observations.reduce(
          (total, observation) =>
            total + (observation.source.extractionConfidence ?? 0),
          0,
        ) / observations.length;
  const report: StructuredReport = {
    schemaVersion: STRUCTURED_REPORT_SCHEMA_VERSION,
    documentId: `image-${createHash("sha256").update(input.bytes).digest("hex").slice(0, 20)}`,
    sourceExtractionSchemaVersion: IMAGE_EXTRACTION_SCHEMA_VERSION,
    status:
      payload.warnings.length > 0 ||
      payload.document.quality === "UNREADABLE"
        ? "PARTIAL"
        : "STRUCTURED",
    layoutAnalysis: {
      strategy: "HEADER",
      confidence: Number(averageConfidence.toFixed(3)),
      evidenceRowCount: observations.length,
      anchors: {
        description: 0,
        value: 0.5,
        unit: 0.7,
        referenceRange: 0.85,
      },
    },
    panels: [{ name: "Vision extracted results", observations }],
    unclassifiedContent: [
      ...(payload.document.quality === "UNREADABLE"
        ? ["The report image was too unclear to extract reliably."]
        : []),
      ...payload.warnings,
    ].map((warning, index) => ({
      text: warning,
      source: {
        pageNumber: sourcePageNumber,
        lineId: `vision-p${sourcePageNumber}-warning-${index + 1}`,
        itemIds: [`vision-p${sourcePageNumber}-warning-item-${index + 1}`],
        boundingBox: { x: 0, y: 0, width: 0, height: 0 },
        extractionMethod: "OPENAI_VISION",
      },
    })),
    statistics: {
      observationCount: observations.length,
      classifiedLineCount: observations.length,
      unclassifiedLineCount:
        payload.warnings.length +
        (payload.document.quality === "UNREADABLE" ? 1 : 0),
    },
  };
  return structuredReportSchema.parse(report);
}
