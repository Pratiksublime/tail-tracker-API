import { NextFunction, Request, Response } from 'express';
// import { redisClient } from '../lib/redis';
import { verifyTokenCheck } from '../utils/jwt';

export interface CustomRequest extends Request {
    tokenData?: {
        userId?: number;
        email?: string;
        role?: string;
        phone?: string;
    };
}

// Define the shape of your Decoded JWT to avoid 'any' errors
interface DecodedToken {
    userId?: number;
    sessionId?: string;
    role: string;
}

export const verifyToken = async (req: CustomRequest, res: Response, next: NextFunction): Promise<void> => {
    const token = req.headers['x-access-token'] as string | undefined;

    if (!token) {
        res.status(403).send({
            success: false,
            message: 'No token provided!',
            data: [],
        });
        return;
    }

    try {
        const decoded = verifyTokenCheck(token) as DecodedToken | null;

        if (!decoded || !decoded.userId) {
            res.status(401).send({ success: false, message: 'Unauthorized!', data: [] });
            return;
        }

        const restrictedRoles = ['FIELD_TECH', 'SHELTER_STAFF'];

        if (restrictedRoles.includes(decoded.role)) {
            try {
                // const activeSessionId = await redisClient.get(`user_session:${decoded.id}`);

                // if (!activeSessionId) {
                //     res.status(401).send({
                //         success: false,
                //         message: 'Session expired — please log in again.',
                //         data: [{ type: "logout" }],
                //     });
                //     return;
                // }

                // if (activeSessionId !== decoded.sessionId) {
                //     res.status(401).send({
                //         success: false,
                //         message: 'Logged in from another device. This session is no longer active.',
                //         data: [{ type: "logout" }],
                //     });
                //     return;
                // }
            } catch (redisError) {
                console.error("Redis Connection Error in Middleware:", redisError);
            }
        }
        req.tokenData = decoded;
        next();

    } catch (err: any) {
        console.log("Token verification error:", err.message);

        const isExpired = err.name === 'TokenExpiredError';

        res.status(401).send({
            success: false,
            message: isExpired ? 'Token Expired!' : 'Unauthorized!',
            data: [],
        });
    }
};