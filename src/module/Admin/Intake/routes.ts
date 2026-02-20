import { Router } from "express";
import { verifyToken } from "../../../middleware/verifyToken";
import * as Controller from "./controller";

const router = Router();

router.get("/workflow-list", verifyToken, Controller.workflowList)
router.put("/processing-status", verifyToken, Controller.updateDogProcessingStatus)
router.get("/release-list", verifyToken, Controller.releaseList)
router.post("/dog-details-by-qr", Controller.getDogDetailsByQrCode)



export default router
