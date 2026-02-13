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


export default router