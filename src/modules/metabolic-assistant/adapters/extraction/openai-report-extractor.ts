import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { MetabolicAssistantError } from "../../contracts/errors.js";
import {
  CANONICAL_EXTRACTION_SCHEMA_VERSION,
  canonicalExtractionResultSchema,
  type CanonicalBiomarker,
  type CanonicalExtractionResult,
} from "../../contracts/extraction.js";
import {
  buildBloodReportExtractionPrompt,
  METABOLIC_EXTRACTION_PROMPT_VERSION,
} from "./extraction-prompt.js";
import {
  openAIExtractionPayloadSchema,
  type OpenAIExtractionPayload,
} from "./openai-extraction-payload.js";
import type {
  ReportExtractionInput,
  ReportExtractor,
} from "./report-extractor.js";

export interface OpenAIReportExtractorOptions {
  apiKey: string;
  model: string;
  store: boolean;
  timeoutMs: number;
  client?: OpenAI;
  now?: () => Date;
}

function optionalText(value: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function buildPatient(
  payload: OpenAIExtractionPayload,
): CanonicalExtractionResult["patient"] {
  const patient: NonNullable<CanonicalExtractionResult["patient"]> = {};
  const name = optionalText(payload.patient.name);
  const dateOfBirth = optionalText(payload.patient.dateOfBirth);
  if (name !== undefined) patient.name = name;
  if (payload.patient.age !== null) patient.age = payload.patient.age;
  if (dateOfBirth !== undefined) patient.dateOfBirth = dateOfBirth;
  if (payload.patient.sex !== null) patient.sex = payload.patient.sex;
  return Object.keys(patient).length > 0 ? patient : undefined;
}

function buildLaboratory(
  payload: OpenAIExtractionPayload,
): CanonicalExtractionResult["laboratory"] {
  const laboratory: NonNullable<CanonicalExtractionResult["laboratory"]> = {};
  const name = optionalText(payload.laboratory.name);
  const reportIdentifier = optionalText(payload.laboratory.reportIdentifier);
  const specimenType = optionalText(payload.laboratory.specimenType);
  const collectedAt = optionalText(payload.laboratory.collectedAt);
  const reportedAt = optionalText(payload.laboratory.reportedAt);
  if (name !== undefined) laboratory.name = name;
  if (reportIdentifier !== undefined) {
    laboratory.reportIdentifier = reportIdentifier;
  }
  if (specimenType !== undefined) laboratory.specimenType = specimenType;
  if (payload.laboratory.fastingStatus !== null) {
    laboratory.fastingStatus = payload.laboratory.fastingStatus;
  }
  if (collectedAt !== undefined) laboratory.collectedAt = collectedAt;
  if (reportedAt !== undefined) laboratory.reportedAt = reportedAt;
  return Object.keys(laboratory).length > 0 ? laboratory : undefined;
}

function buildBiomarker(
  marker: OpenAIExtractionPayload["biomarkers"][number],
  index: number,
): CanonicalBiomarker {
  const result: CanonicalBiomarker = {
    id: `${marker.canonicalCode}-${index + 1}`,
    canonicalCode: marker.canonicalCode,
    panel: marker.panel,
    sourceLabel: marker.sourceLabel.trim(),
    status: marker.status,
    confidence: marker.confidence,
    reviewState:
      marker.confidence < 0.85 ||
      marker.canonicalCode === "other" ||
      marker.status === "UNKNOWN"
        ? "NEEDS_REVIEW"
        : "UNREVIEWED",
  };
  if (marker.numericValue !== null) result.numericValue = marker.numericValue;
  const textValue = optionalText(marker.textValue);
  const unit = optionalText(marker.unit);
  const sourceReferenceRange = optionalText(marker.sourceReferenceRange);
  const sourceFlag = optionalText(marker.sourceFlag);
  const evidenceText = optionalText(marker.evidenceText);
  if (textValue !== undefined) result.textValue = textValue;
  if (unit !== undefined) result.unit = unit;
  if (sourceReferenceRange !== undefined) {
    result.sourceReferenceRange = sourceReferenceRange;
  }
  if (marker.referenceLower !== null) {
    result.referenceLower = marker.referenceLower;
  }
  if (marker.referenceUpper !== null) {
    result.referenceUpper = marker.referenceUpper;
  }
  if (sourceFlag !== undefined) result.sourceFlag = sourceFlag;
  if (marker.sourcePage !== null) result.sourcePage = marker.sourcePage;
  if (evidenceText !== undefined) result.evidenceText = evidenceText;
  return result;
}

export class OpenAIReportExtractor implements ReportExtractor {
  readonly providerKind = "openai" as const;
  readonly #client: OpenAI;
  readonly #model: string;
  readonly #store: boolean;
  readonly #timeoutMs: number;
  readonly #now: () => Date;

  constructor(options: OpenAIReportExtractorOptions) {
    this.#client =
      options.client ??
      new OpenAI({
        apiKey: options.apiKey,
        timeout: options.timeoutMs,
        maxRetries: 0,
      });
    this.#model = options.model;
    this.#store = options.store;
    this.#timeoutMs = options.timeoutMs;
    this.#now = options.now ?? (() => new Date());
  }

  async extract(
    input: ReportExtractionInput,
  ): Promise<CanonicalExtractionResult> {
    const base64 = Buffer.from(input.bytes).toString("base64");
    const reportContent =
      input.mimeType === "application/pdf"
        ? {
            type: "input_file" as const,
            filename: input.fileName,
            file_data: `data:application/pdf;base64,${base64}`,
          }
        : {
            type: "input_image" as const,
            image_url: `data:${input.mimeType};base64,${base64}`,
            detail: "high" as const,
          };

    try {
      const response = await this.#client.responses.parse(
        {
          model: this.#model,
          store: this.#store,
          max_output_tokens: 12_000,
          input: [
            {
              role: "system",
              content: buildBloodReportExtractionPrompt(),
            },
            {
              role: "user",
              content: [
                reportContent,
                {
                  type: "input_text",
                  text: "Extract this blood report into the required schema.",
                },
              ],
            },
          ],
          text: {
            format: zodTextFormat(
              openAIExtractionPayloadSchema,
              "blood_report_extraction",
            ),
          },
        },
        { timeout: this.#timeoutMs },
      );

      const payload = response.output_parsed;
      if (payload === null) {
        throw new MetabolicAssistantError(
          "EXTRACTION_INVALID_OUTPUT",
          "OpenAI did not return a parsed extraction payload.",
        );
      }
      if (!payload.document.isBloodReport) {
        throw new MetabolicAssistantError(
          "NOT_A_BLOOD_REPORT",
          "The uploaded file was not recognized as a blood report.",
        );
      }

      const result: CanonicalExtractionResult = {
        schemaVersion: CANONICAL_EXTRACTION_SCHEMA_VERSION,
        reportId: input.reportId,
        provider: {
          kind: "openai",
          name: "openai-responses",
          version: "1",
          model: this.#model,
          promptVersion: METABOLIC_EXTRACTION_PROMPT_VERSION,
          responseId: response.id,
        },
        source: {
          fileName: input.fileName,
          mimeType: input.mimeType,
          sha256: input.sha256,
        },
        biomarkers: payload.biomarkers.map(buildBiomarker),
        warnings: payload.warnings.map((warning) => {
          const canonicalWarning: CanonicalExtractionResult["warnings"][number] = {
            code: warning.code.trim(),
            message: warning.message.trim(),
          };
          if (warning.sourcePage !== null) {
            canonicalWarning.sourcePage = warning.sourcePage;
          }
          return canonicalWarning;
        }),
        extractedAt: this.#now().toISOString(),
      };
      const pageCount =
        input.mimeType === "application/pdf"
          ? payload.document.pageCount
          : 1;
      if (pageCount !== null) result.source.pageCount = pageCount;
      const patient = buildPatient(payload);
      const laboratory = buildLaboratory(payload);
      if (patient !== undefined) result.patient = patient;
      if (laboratory !== undefined) result.laboratory = laboratory;
      return canonicalExtractionResultSchema.parse(result);
    } catch (error) {
      if (error instanceof MetabolicAssistantError) throw error;
      throw new MetabolicAssistantError(
        "EXTRACTION_PROVIDER_ERROR",
        "OpenAI report extraction failed.",
        { cause: error },
      );
    }
  }
}
