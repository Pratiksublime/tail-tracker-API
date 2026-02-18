import { Router } from "express";
import * as Controller from "./controller";

const router = Router();

router.post("/complaint-add", Controller.addComplaint)

router.get("/complaint-list", Controller.getComplaintList)


export default router
