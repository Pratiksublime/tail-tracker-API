import { Router } from "express";
import { verifyToken } from "../../../middleware/verifyToken";
import * as Controller from "./controller";

const router = Router();

router.post("/capture", verifyToken, Controller.capture)
router.post("/upload-photos", verifyToken, Controller.uploadPhotos)
router.get("/scan/:rfid", verifyToken, Controller.scanByRfid)
router.put("/link-rfid", verifyToken, Controller.linkRfid)
router.get("/list", verifyToken, Controller.list)
router.post("/verify", verifyToken, Controller.verify)
router.post("/identify", verifyToken, Controller.identify)
router.post("/batch", verifyToken, Controller.batchIntake)

router.post("/batch-rescue", verifyToken, Controller.batchRescueIntake)
router.post("/transfer", verifyToken, Controller.transferCapturedDogs)
router.put("/processing-status", verifyToken, Controller.updateDogProcessingStatus)
router.get("/release-list", verifyToken, Controller.releaseList)
router.post("/release", verifyToken, Controller.releaseDogs)
router.post("/dog-details-by-qr", verifyToken, Controller.getDogDetailsByQrCode)
router.get("/workflow-counts", verifyToken, Controller.getWorkflowCounts)

export default router
