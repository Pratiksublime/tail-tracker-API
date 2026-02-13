import jwt, { SignOptions } from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-fallback-secret';
const EXPIRES_IN = '24h';

export interface JwtPayload {
    userId: number;
    sessionId?: string;
    role?: string;
}

export function signToken(payload: JwtPayload, expiresIn?: string | number): string {
    // 1. Force the secret to be a string
    const secret = JWT_SECRET as string;

    // 2. Explicitly type the options object
    // We cast expiresIn to 'any' or 'SignOptions['expiresIn']' to satisfy the library's internal StringValue type
    const options: SignOptions = {
        expiresIn: (expiresIn || EXPIRES_IN) as any
    };

    return jwt.sign(payload, secret, options);
}

export function verifyTokenCheck(token: string): JwtPayload {
    // Cast the result to your interface
    return jwt.verify(token, JWT_SECRET as string) as JwtPayload;
}