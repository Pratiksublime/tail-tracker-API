import { Router } from "express";
import * as Controller from "./controller";

const router = Router();

// Legacy UUID-based QR
router.get("/generate", Controller.generateQrCode);

// Deterministic tag-code APIs
router.post("/tag/batch", Controller.createTagBatch);
router.post("/tag/batch/pdf", Controller.generateBulkTagPdf);
router.post("/tag/generate", Controller.generateSingleTagCode);
router.post("/tag/regenerate", Controller.regenerateTagCode);
router.post("/tag/parse", Controller.parseTagCode);
router.post("/tag/validate", Controller.validateTagCode);
router.post("/tag/image", Controller.generateTagQrImage);
router.get("/tag/next-prefix", Controller.getNextTagPrefix);
router.get("/tag/batch/:prefix", Controller.getTagBatchByPrefix);
router.get("/tag/:codeCompact", Controller.getTagByCodeCompact);

// Existing scan + assignment APIs
router.get("/getScanInfo", Controller.getScanInfo);
router.post("/assignScannedCodeToDog", Controller.assignScannedCodeToDog);

export default router;
