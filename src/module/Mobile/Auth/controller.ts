import { Request, Response } from "express";
import { prisma } from "../../../lib/prisma";
// import { redisClient } from "../../../lib/redis";
import { CustomRequest } from '../../../middleware/verifyToken';
import { comparePassword, hashPassword } from '../../../utils/auth.util';
import { sendOtpEmail } from "../../../utils/emailTemplates";
import { signToken } from "../../../utils/jwt";
import { validate } from "../../../utils/validator";


const STATUS_ACTIVE = Number(process.env.STATUS_ACTIVE);
const STATUS_DELETED = Number(process.env.STATUS_DELETED);


export const login = async (req: Request, res: Response): Promise<void> => {
    const { email, password, forceLogin } = req.body;

    const validationRules: any = {
        email: "required|email",
        password: "required|min:6|max:20",
    };
    const { passed, errors } = validate(req.body, validationRules);
    if (!passed) {
        res.status(422).json({
            success: false,
            message: "Validation failed",
            data: errors,
        });
        return;
    }

    try {
        const user = await prisma.user.findFirst({
            where: {
                email: email,
            },
        });

        if (!user) {
            res.status(201).json({
                success: false,
                message: "User not found",
                data: [],
            });
            return;
        }

        const isMatch = await comparePassword(password, user.passwordHash);

        if (!isMatch) {
            res.status(201).json({
                success: false,
                message: "Invalid password",
                data: [],
            });
            return;
        }

        // const existingSession = await redisClient.get(`user_session:${user.id}`);
        // if (existingSession && !forceLogin && forceLogin !== undefined) {
        //     res.status(202).json({
        //         success: false,
        //         message: "User already logged in with another device, Please logout first",
        //         data: [{ type: "logout" }]
        //     });
        //     return;
        // }

        // create a new session in redis with expiry of 24 hours and unique for each user
        // const newSessionId = uuidv4();
        // await redisClient.set(`user_session:${user.id}`, newSessionId, { EX: 60 * 60 * 24 });

        const tokenData = {
            userId: user.id,
            email: user.email,
            role: user.role,
            phone: user.phone
        }
        const token = signToken(tokenData);

        const userResponse = { ...user };
        delete (userResponse as any).passwordHash;

        res.status(200).json({
            success: true,
            message: "Login successful",
            data: [userResponse],
            token: token
        });

    } catch (error) {
        console.error("Error logging in:", error);
        res.status(500).json({ success: false, message: "Internal server error", data: [] });
    }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.body

    try {
        const validationRules: any = {
            id: "required|numeric",
        };
        const { passed, errors } = validate(req.body, validationRules);
        if (!passed) {
            res.status(422).json({
                success: false,
                message: "Validation failed",
                data: errors,
            });
            return;
        }
        //  check user exist or not
        const user = await prisma.user.findUnique({
            where: {
                id: id,
            },
        });
        if (!user) {
            res.status(202).json({ success: false, message: "No Account Found" });
            return;
        }

        // await redisClient.del(`user_session:${id}`);
        res.status(200).json({
            success: true,
            message: "Logout successful",
            data: [],
        });
    } catch (error) {
        console.error("Error during logout:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
    const { email } = req.body;

    const validationRules: any = { email: "required|email" };
    const { passed, errors } = validate(req.body, validationRules);

    if (!passed) {
        res.status(422).json({ success: false, message: "Validation failed", data: errors });
        return;
    }

    try {
        const user = await prisma.user.findFirst({
            where: { email: email, isActive: true },
        });

        if (!user) {
            res.status(404).json({ success: false, message: "No Account Found" });
            return;
        }

        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

        try {
            await prisma.$transaction([
                prisma.otp.deleteMany({ where: { userId: user.id } }),
                prisma.otp.create({
                    data: {
                        userId: user.id,
                        otp: otpCode,
                        expiresAt: new Date(Date.now() + 1000 * 60 * 5), // 5 Mins
                    },
                }),
            ]);

            await sendOtpEmail(user.email, otpCode, user.name);

            res.status(200).json({
                success: true,
                message: "OTP sent successfully to your registered email",
                data: [otpCode] // REMOVE THIS in production! Only for local testing.
            });

        } catch (error) {
            console.error("OTP Creation Error:", error);
            res.status(500).json({ success: false, message: "Failed to process OTP" });
        }
    } catch (error) {
        console.error("Database Error:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

export const verifyOTP = async (req: Request, res: Response): Promise<void> => {
    const { email, otp } = req.body;

    const validationRules: any = { email: "required|email", otp: "required|numeric" };
    const { passed, errors } = validate(req.body, validationRules);

    if (!passed) {
        res.status(422).json({ success: false, message: "Validation failed", data: errors });
        return;
    }

    try {
        const user = await prisma.user.findFirst({
            where: { email: email, isActive: true },
        });

        if (!user) {
            res.status(404).json({ success: false, message: "No Account Found" });
            return;
        }

        const otpRecord = await prisma.otp.findFirst({
            where: { userId: user.id, otp: otp, expiresAt: { gt: new Date() } },
            orderBy: { createdAt: "desc" },
        });

        if (!otpRecord) {
            res.status(400).json({ success: false, message: "Invalid or expired OTP" });
            return;
        }

        await prisma.otp.deleteMany({ where: { userId: user.id } });

        res.status(200).json({ success: true, message: "OTP verified successfully", data: [] });


    } catch (error) {
        console.error("Database Error:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
}

export const changePassword = async (req: Request, res: Response): Promise<void> => {
    const { email, newPassword } = req.body;

    try {
        const user = await prisma.user.findUnique({
            where: { email: email, isActive: true },
        });

        if (!user) {
            res.status(404).json({ success: false, message: "No Account Found" });
            return;
        }

        const hashedNewPassword = await hashPassword(newPassword);

        await prisma.user.update({
            where: { id: user.id },
            data: { passwordHash: hashedNewPassword },
        });

        // await redisClient.del(`user_session:${user.id}`);

        res.status(200).json({
            success: true,
            message: "Password changed successfully. Please log in again with your new password.",
            data: [],
        });
    } catch (error) {
        console.error("Database Error:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
}

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
    const email = (req as any).tokenData?.email;
    const { oldPassword, newPassword } = req.body;

    try {
        const user = await prisma.user.findUnique({
            where: { email: email, isActive: true },
        });

        if (!user) {
            res.status(404).json({ success: false, message: "No Account Found" });
            return;
        }

        const isMatch = await comparePassword(oldPassword, user.passwordHash);
        if (!isMatch) {
            res.status(400).json({ success: false, message: "Incorrect old password" });
            return;
        }

        const hashedNewPassword = await hashPassword(newPassword);

        await prisma.user.update({
            where: { id: user.id },
            data: { passwordHash: hashedNewPassword },
        });

        // await redisClient.del(`user_session:${user.id}`);

        res.status(200).json({
            success: true,
            message: "Password changed successfully. Please log in again with your new password.",
            data: [{ id: user.id, email: user.email }]
        });

    } catch (error) {
        console.error("Error changing password:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
}


export const getProfile = async (req: CustomRequest, res: Response): Promise<void> => {
    const userId = Number(req.tokenData?.userId);

    try {
        // 2. Fetch user from database
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                status: true,
                createdAt: true,
            }
        });

        if (!user) {
            res.status(404).json({
                success: false,
                message: "Profile not found",
            });
            return;
        }

        res.status(200).json({
            success: true,
            message: "Profile retrieved successfully",
            data: user
        });

    } catch (error) {
        console.error("Error fetching profile:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
};

export const versionValidation = async (req: Request, res: Response): Promise<void> => {
    const { version } = req.body;

    if (version < Number(process.env.REQUIRED_MOBILE_APP_VERSION)) {
        res.status(200).send({
            success: true,
            message: "Please update your app to continue",
            data: { requiredVersion: 2 }, // force update
        })
        return
    } else if (version < Number(process.env.CURRENT_VERSION)) {
        res.status(200).send({
            success: true,
            message: "New version of the app is available",
            data: { requiredVersion: 1 }, //optional update
        })
        return
    }

    res.status(200).send({
        success: true,
        message: "App is up to date",
        data: { requiredVersion: 0 },
    })
}