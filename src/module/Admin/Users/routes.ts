import { Router } from "express";
import * as Controller from "./controller";

const router = Router();


router.post("/create", Controller.create)
router.get("/list", Controller.list)
router.delete("/delete/:id", Controller.deleteUser)


export default router
