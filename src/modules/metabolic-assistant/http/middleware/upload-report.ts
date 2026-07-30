import multer from "multer";

export function createReportUploadMiddleware(maxFileBytes: number) {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      files: 1,
      fileSize: maxFileBytes,
      fields: 4,
    },
  });
}
