import { Router } from "express";
import * as Controller from "./controller";

const router = Router();

// Legacy UUID-based QR
router.get("/generate", Controller.generateQrCode);

// Deterministic tag-code APIs
router.post("/tag/batch", Controller.createTagBatch);
router.post("/tag/batch/pdf", Controller.generateBulkTagPdf);
router.get("/tag/fetch", Controller.fetchTag);

// Existing scan + assignment APIs
router.post("/assignScannedCodeToDog", Controller.assignScannedCodeToDog);

export default router;
