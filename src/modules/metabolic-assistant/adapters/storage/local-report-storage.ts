import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, extname, resolve, sep } from "node:path";
import type {
  ReadableReportStorage,
  StoreReportFileInput,
  StoredReportFile,
} from "./report-storage.js";

function safeExtension(originalName: string): string {
  const extension = extname(basename(originalName)).toLowerCase();
  return [".pdf", ".jpg", ".jpeg", ".png"].includes(extension)
    ? extension
    : "";
}

export class LocalReportStorage implements ReadableReportStorage {
  readonly #rootDirectory: string;

  constructor(rootDirectory: string) {
    this.#rootDirectory = resolve(rootDirectory);
  }

  async store(input: StoreReportFileInput): Promise<StoredReportFile> {
    await mkdir(this.#rootDirectory, { recursive: true });
    const objectKey = `${input.reportId}-${input.sha256.slice(0, 16)}${safeExtension(input.originalName)}`;
    const targetPath = this.#resolveObjectKey(objectKey);
    await writeFile(targetPath, input.bytes, { flag: "wx", mode: 0o600 });
    return {
      storageProvider: "local",
      objectKey,
      byteSize: input.bytes.byteLength,
    };
  }

  async delete(objectKey: string): Promise<void> {
    await rm(this.#resolveObjectKey(objectKey), { force: true });
  }

  async read(objectKey: string): Promise<Uint8Array> {
    return readFile(this.#resolveObjectKey(objectKey));
  }

  #resolveObjectKey(objectKey: string): string {
    const targetPath = resolve(this.#rootDirectory, objectKey);
    if (!targetPath.startsWith(`${this.#rootDirectory}${sep}`)) {
      throw new Error("Invalid report storage object key.");
    }
    return targetPath;
  }
}
