import { Router } from "express";
import { verifyToken } from "../../../middleware/verifyToken";
import * as Controller from "./controller";

const router = Router();


router.post("/list", verifyToken, Controller.list)
router.post("/by-id", verifyToken, Controller.getById)
router.post("/by-rfid", verifyToken, Controller.getByRfid)
router.post("/by-temp", verifyToken, Controller.getByTempId)
router.post("/upload-photos", verifyToken, Controller.uploadPhotos)
router.post("/delete-photo", verifyToken, Controller.deletePhoto)
// router.get("/state", verifyToken, Controller.getCurrentState)
// router.post("/state/transition", verifyToken, Controller.updateState)
// router.get("/state/history", verifyToken, Controller.getStateHistory)
// router.get("/state/allowed", verifyToken, Controller.getAllowedStateTransitions)


export default router