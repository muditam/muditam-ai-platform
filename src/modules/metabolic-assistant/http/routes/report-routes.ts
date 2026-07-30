import { Router } from "express";
import type { MetabolicEnvironment } from "../../config/env.js";
import { ReportController } from "../controllers/report-controller.js";
import { createReportUploadMiddleware } from "../middleware/upload-report.js";

export function createReportRouter(
  controller: ReportController,
  environment: MetabolicEnvironment,
): Router {
  const router = Router();
  const upload = createReportUploadMiddleware(
    environment.METABOLIC_MAX_FILE_BYTES,
  );

  router.post("/", upload.single("report"), controller.upload);
  router.get("/", controller.list);
  router.get("/:reportId", controller.get);
  router.delete("/:reportId", controller.delete);

  return router;
}
