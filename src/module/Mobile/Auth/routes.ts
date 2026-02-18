import { Router } from "express";
import { verifyToken } from "../../../middleware/verifyToken";
import * as Controller from "./controller";

const router = Router();


router.post("/login", Controller.login)
router.post("/logout", Controller.logout)
router.post("/forgot-password", Controller.forgotPassword)
router.post("/verify-otp", Controller.verifyOTP)
router.post("/change-password", Controller.changePassword)
router.post("/reset-password", Controller.resetPassword)
router.get("/profile", verifyToken, Controller.getProfile)
router.post("/versionValidation", Controller.versionValidation)




export default router