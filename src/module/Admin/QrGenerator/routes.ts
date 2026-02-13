import { Router } from "express";
import * as Controller from "./controller";

const router = Router();


router.get("/generate", Controller.generateQrCode);
router.get("/getScanInfo", Controller.getScanInfo);
router.post("/assignScannedCodeToDog", Controller.assignScannedCodeToDog);

export default router
