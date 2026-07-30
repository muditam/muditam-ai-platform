import type { SupportedReportMimeType } from "../extraction/report-extractor.js";

export interface StoreReportFileInput {
  reportId: string;
  originalName: string;
  mimeType: SupportedReportMimeType;
  sha256: string;
  bytes: Uint8Array;
}

export interface StoredReportFile {
  storageProvider: "local" | "s3";
  objectKey: string;
  byteSize: number;
}

export interface ReportStorage {
  store(input: StoreReportFileInput): Promise<StoredReportFile>;
  delete(objectKey: string): Promise<void>;
}

export interface ReadableReportStorage extends ReportStorage {
  read(objectKey: string): Promise<Uint8Array>;
}
