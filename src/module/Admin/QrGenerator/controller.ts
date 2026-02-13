import { Request, Response } from "express";
import path from "path";
import QRCode from "qrcode";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import { prisma } from "../../../lib/prisma";

const STATUS_ACTIVE = Number(process.env.STATUS_ACTIVE) || 1;
const STATUS_DELETED = Number(process.env.STATUS_DELETED) || 0;


const COMPANY_WEBSITE_URL = process.env.COMPANY_WEBSITE_URL || "https://yourcompany.com";
// If env is set, use it. Otherwise, default to public/logo.png
const LOGO_PATH =
    process.env.QR_LOGO_PATH
        ? path.isAbsolute(process.env.QR_LOGO_PATH)
            ? process.env.QR_LOGO_PATH
            : path.join(process.cwd(), process.env.QR_LOGO_PATH)
        : path.join(process.cwd(), "public", "logo.png");



export const generateQrCode = async (req: Request, res: Response) => {
    try {
        // 1) Generate unique code (NOT saved in DB here)
        const token = uuidv4();

        // 2) QR will open your scan page with the code
        const qrUrl = `${COMPANY_WEBSITE_URL.replace(/\/$/, "")}/scan/${encodeURIComponent(
            token
        )}`;

        console.log("qrUrl", qrUrl);

        // 3) Generate QR PNG (use high EC to survive logo overlay)
        const qrPng = await QRCode.toBuffer(qrUrl, {
            errorCorrectionLevel: "H",
            type: "png",
            margin: 2,
            width: 400,
            color: { dark: "#000000", light: "#FFFFFF" },
        });

        // 4) Load + resize logo (logo in center must be smaller for 400px QR)
        const logoSize = 80; // good for 400px QR
        const logo = await sharp(LOGO_PATH)
            .resize(logoSize, logoSize, { fit: "contain" })
            .png()
            .toBuffer();

        // 5) Add white background behind logo for better scan reliability
        const logoWithBg = await sharp({
            create: {
                width: logoSize + 24,
                height: logoSize + 24,
                channels: 4,
                background: { r: 255, g: 255, b: 255, alpha: 1 },
            },
        })
            .composite([{ input: logo, gravity: "center" }])
            .png()
            .toBuffer();

        // 6) Composite logo on QR center
        const finalPng = await sharp(qrPng)
            .composite([{ input: logoWithBg, gravity: "center" }])
            .png()
            .toBuffer();

        // 7) Return PNG + headers (helpful for Postman)
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "no-store"); // optional
        res.setHeader("X-QR-URL", qrUrl);
        res.setHeader("X-QR-TOKEN", token);

        return res.status(200).send(finalPng);
    } catch (e: any) {
        console.error(e);
        return res.status(500).json({
            message: "Failed to generate QR",
            error: e?.message,
        });
    }
};


export const getScanInfo = async (req: Request, res: Response) => {

    const code = String(req.query.code || "");
    if (!code) return res.status(400).json({ message: "code required" });

    try {
        const dog = await prisma.dog.findUnique({
            where: { qrCode: code }
        });

        if (!dog) {
            res.status(201).json({
                success: false,
                message: "Dog not found",
                data: []
            })
        }

        return res.status(200).json({
            success: true,
            message: "Dog found",
            data: [dog]
        })

    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: "Failed to get scan info",
            data: []
        });
    }

};

export const assignScannedCodeToDog = async (req: Request, res: Response) => {
    const code = String(req.body.code || "");
    const dogId = Number(req.body.dogId);

    if (!code) return res.status(400).json({ message: "code required" });
    if (!dogId || Number.isNaN(dogId)) return res.status(400).json({ message: "dogId required" });

    // Make sure code isn't already used by another dog
    const alreadyUsed = await prisma.dog.findUnique({
        where: { qrCode: code },
        select: { id: true, tempId: true },
    });
    if (alreadyUsed) {
        return res.status(409).json({
            message: "This QR code is already assigned to another dog",
            assignedDog: { dogId: alreadyUsed.id, dogUniqueId: alreadyUsed.tempId },
        });
    }

    // Assign only if dog's qrCode is null (prevents changing it later)
    const updated = await prisma.dog.updateMany({
        where: { id: dogId, qrCode: null },
        data: { qrCode: code, qrAssignedAt: new Date() },
    });

    if (updated.count === 0) {
        // either dog doesn't exist OR already has a qrCode
        const dog = await prisma.dog.findUnique({
            where: { id: dogId },
            select: { id: true, tempId: true, qrCode: true },
        });

        if (!dog) return res.status(404).json({ message: "Dog not found" });

        return res.status(409).json({
            message: "This dog already has a QR assigned and it cannot be changed",
            dogId: dog.id,
            dogUniqueId: dog.tempId,
            existingQrCode: dog.qrCode,
        });
    }

    const dog = await prisma.dog.findUnique({
        where: { id: dogId },
        select: { id: true, tempId: true, qrCode: true },
    });

    return res.status(200).json({
        message: "QR assigned successfully",
        dogId: dog!.id,
        dogUniqueId: dog!.tempId,
        qrCode: dog!.qrCode,
    });
};