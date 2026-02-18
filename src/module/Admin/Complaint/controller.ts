
import { Prisma } from "@prisma/client";
import { Request, Response } from "express";
import { UploadedFile } from "express-fileupload";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { prisma } from "../../../lib/prisma";

const STATUS_ACTIVE = Number(process.env.STATUS_ACTIVE) || 1;
const STATUS_DELETED = Number(process.env.STATUS_DELETED) || 0;

type ComplaintSubjectValue =
    | "DOG_BITE"
    | "AGGRESSIVE_DOG_BEHAVIOUR"
    | "INJURED_OR_SICK_STRAY_DOG"
    | "STRAY_DOG_NUISANCE"
    | "NOISE_OR_DISTURBANCE"
    | "OTHER_ISSUE";

const SUBJECT_MAP: Record<string, ComplaintSubjectValue> = {
    "dog_bite": "DOG_BITE",
    "dog bite": "DOG_BITE",
    "aggressive_dog_behaviour": "AGGRESSIVE_DOG_BEHAVIOUR",
    "aggressive dog behaviour": "AGGRESSIVE_DOG_BEHAVIOUR",
    "injured_or_sick_stray_dog": "INJURED_OR_SICK_STRAY_DOG",
    "injured or sick stray dog": "INJURED_OR_SICK_STRAY_DOG",
    "stray_dog_nuisance": "STRAY_DOG_NUISANCE",
    "stray dog nuisance": "STRAY_DOG_NUISANCE",
    "noise_or_disturbance": "NOISE_OR_DISTURBANCE",
    "noise / disturbance": "NOISE_OR_DISTURBANCE",
    "other_issue": "OTHER_ISSUE",
    "other issue": "OTHER_ISSUE",
};

const SUBJECT_LABEL: Record<ComplaintSubjectValue, string> = {
    DOG_BITE: "Dog Bite",
    AGGRESSIVE_DOG_BEHAVIOUR: "Aggressive Dog Behaviour",
    INJURED_OR_SICK_STRAY_DOG: "Injured or Sick Stray Dog",
    STRAY_DOG_NUISANCE: "Stray Dog Nuisance",
    NOISE_OR_DISTURBANCE: "Noise / Disturbance",
    OTHER_ISSUE: "Other Issue",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeSubject(input: string): ComplaintSubjectValue | null {
    const key = String(input || "").trim().toLowerCase();
    return SUBJECT_MAP[key] || null;
}

async function storeComplaintAttachment(req: Request): Promise<string | null> {
    const filesBag = (req.files && typeof req.files === "object")
        ? (req.files as Record<string, unknown>)
        : {};

    const attachmentRaw = filesBag.attachment || filesBag.file || filesBag.image;
    const attachment = Array.isArray(attachmentRaw) ? attachmentRaw[0] as UploadedFile : attachmentRaw as UploadedFile | undefined;

    const uploadDir = path.join(process.cwd(), "public", "uploads", "complaints");
    fs.mkdirSync(uploadDir, { recursive: true });

    if (attachment) {
        const allowed = new Set([
            "image/jpeg",
            "image/jpg",
            "image/png",
            "image/webp",
            "application/pdf",
        ]);
        if (!allowed.has(attachment.mimetype)) {
            throw new Error(`Unsupported attachment type: ${attachment.mimetype}`);
        }

        const ext = path.extname(attachment.name || "").toLowerCase()
            || (attachment.mimetype === "application/pdf" ? ".pdf" : ".jpg");
        const fileName = `${uuidv4()}${ext}`;
        const absolutePath = path.join(uploadDir, fileName);
        await attachment.mv(absolutePath);
        return `${req.protocol}://${req.get("host")}/uploads/complaints/${fileName}`;
    }

    const base64Raw = String((req.body as any)?.attachmentBase64 || "").trim();
    if (!base64Raw) return null;

    const matched = base64Raw.match(/^data:([a-zA-Z0-9.+/-]+);base64,(.+)$/);
    const mime = matched?.[1] || "image/jpeg";
    const data = matched?.[2] || base64Raw;
    const allowed = new Set([
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp",
        "application/pdf",
    ]);
    if (!allowed.has(mime)) {
        throw new Error(`Unsupported base64 attachment type: ${mime}`);
    }

    const ext = mime === "image/png"
        ? ".png"
        : mime === "image/webp"
            ? ".webp"
            : mime === "application/pdf"
                ? ".pdf"
                : ".jpg";
    const fileName = `${uuidv4()}${ext}`;
    const absolutePath = path.join(uploadDir, fileName);
    fs.writeFileSync(absolutePath, Buffer.from(data, "base64"));
    return `${req.protocol}://${req.get("host")}/uploads/complaints/${fileName}`;
}

export const addComplaint = async (req: Request, res: Response): Promise<void> => {
    try {
        const payload = (req.body && typeof req.body === "object") ? req.body : {};
        // const { userId } = (req as any).tokenData || {};

        const firstName = String((payload as any).firstName || "").trim();
        const lastName = String((payload as any).lastName || "").trim();
        const email = String((payload as any).email || "").trim();
        const phoneNumber = String((payload as any).phoneNumber || (payload as any).phone || "").trim();
        const subjectInput = String((payload as any).subject || "").trim();
        const message = String((payload as any).message || "").trim();
        const otherSubjectText = String((payload as any).otherSubjectText || "").trim();

        const subject = normalizeSubject(subjectInput);
        const errors: Record<string, string[]> = {};
        if (!firstName) errors.firstName = ["firstName is required"];
        if (!lastName) errors.lastName = ["lastName is required"];
        if (!email || !EMAIL_RE.test(email)) errors.email = ["Valid email is required"];
        if (!phoneNumber) errors.phoneNumber = ["phoneNumber is required"];
        if (!subject) errors.subject = ["subject is invalid or missing"];
        if (!message) errors.message = ["message is required"];
        if (subject === "OTHER_ISSUE" && !otherSubjectText) {
            errors.otherSubjectText = ["otherSubjectText is required when subject is Other Issue"];
        }

        if (Object.keys(errors).length > 0) {
            res.status(422).json({
                success: false,
                message: "Validation failed",
                data: errors,
            });
            return;
        }

        let attachmentUrl: string | null = null;
        try {
            attachmentUrl = await storeComplaintAttachment(req);
        } catch (e: any) {
            res.status(422).json({
                success: false,
                message: e?.message || "Invalid attachment",
                data: [],
            });
            return;
        }

        const inserted = await prisma.$queryRaw<Array<{
            id: number;
            first_name: string;
            last_name: string;
            email: string;
            phone_number: string;
            subject: ComplaintSubjectValue;
            other_subject_text: string | null;
            message: string;
            attachment_url: string | null;
            created_at: Date;
        }>>(Prisma.sql`
            INSERT INTO complaints (
                first_name,
                last_name,
                email,
                phone_number,
                subject,
                other_subject_text,
                message,
                attachment_url,
                created_by_user_id,
                status,
                created_at,
                updated_at
            )
            VALUES (
                ${firstName},
                ${lastName},
                ${email},
                ${phoneNumber},
                ${subject}::"ComplaintSubject",
                ${subject === "OTHER_ISSUE" ? otherSubjectText : null},
                ${message},
                ${attachmentUrl},
                null,
                ${STATUS_ACTIVE},
                NOW(),
                NOW()
            )
            RETURNING
                id,
                first_name,
                last_name,
                email,
                phone_number,
                subject,
                other_subject_text,
                message,
                attachment_url,
                created_at
        `);
        const created = inserted[0];

        res.status(201).json({
            success: true,
            message: "Complaint submitted successfully",
            data: [{
                id: created.id,
                firstName: created.first_name,
                lastName: created.last_name,
                email: created.email,
                phoneNumber: created.phone_number,
                subject: created.subject,
                subjectLabel: SUBJECT_LABEL[created.subject],
                otherSubjectText: created.other_subject_text,
                message: created.message,
                attachmentUrl: created.attachment_url,
                createdAt: created.created_at,
            }],
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: error?.message || "Failed to submit complaint",
            data: [],
        });
    }
}

export const getComplaintList = async (req: Request, res: Response): Promise<void> => {
    try {
        const page = Math.max(1, Number(req.query.page || 1));
        const limit = Math.min(1000, Math.max(1, Number(req.query.limit || 20)));
        const skip = (page - 1) * limit;
        const q = String(req.query.q || "").trim();
        const subjectInput = String(req.query.subject || "").trim();
        const subject = subjectInput ? normalizeSubject(subjectInput) : null;

        if (subjectInput && !subject) {
            res.status(422).json({
                success: false,
                message: "Validation failed",
                data: { subject: ["Invalid subject filter"] },
            });
            return;
        }

        const conditions: Prisma.Sql[] = [Prisma.sql`status <> ${STATUS_DELETED}`];
        if (subject) conditions.push(Prisma.sql`subject = ${subject}::"ComplaintSubject"`);
        if (q) {
            const like = `%${q}%`;
            conditions.push(
                Prisma.sql`(
                    first_name ILIKE ${like}
                    OR last_name ILIKE ${like}
                    OR COALESCE(first_name, '') || ' ' || COALESCE(last_name, '') ILIKE ${like}
                    OR email ILIKE ${like}
                    OR phone_number ILIKE ${like}
                    OR message ILIKE ${like}
                )`
            );
        }

        const whereSql = conditions.length
            ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
            : Prisma.empty;

        const [countRows, complaints] = await Promise.all([
            prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
                SELECT COUNT(*)::int AS total
                FROM complaints
                ${whereSql}
            `),
            prisma.$queryRaw<Array<{
                id: number;
                first_name: string;
                last_name: string;
                email: string;
                phone_number: string;
                subject: ComplaintSubjectValue;
                other_subject_text: string | null;
                message: string;
                attachment_url: string | null;
                created_by_user_id: number | null;
                created_at: Date;
                updated_at: Date;
            }>>(Prisma.sql`
                SELECT
                    id,
                    first_name,
                    last_name,
                    email,
                    phone_number,
                    subject,
                    other_subject_text,
                    message,
                    attachment_url,
                    created_by_user_id,
                    created_at,
                    updated_at
                FROM complaints
                ${whereSql}
                ORDER BY created_at DESC
                OFFSET ${skip}
                LIMIT ${limit}
            `),
        ]);
        const total = Number(countRows[0]?.total || 0);

        res.status(200).json({
            success: true,
            message: "Complaint list fetched",
            data: complaints.map((c) => ({
                id: c.id,
                firstName: c.first_name,
                lastName: c.last_name,
                email: c.email,
                phoneNumber: c.phone_number,
                subject: c.subject,
                subjectLabel: SUBJECT_LABEL[c.subject],
                otherSubjectText: c.other_subject_text,
                message: c.message,
                attachmentUrl: c.attachment_url,
                createdByUserId: c.created_by_user_id,
                createdAt: c.created_at,
                updatedAt: c.updated_at,
            })),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.max(1, Math.ceil(total / limit)),
            },
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: error?.message || "Failed to fetch complaint list",
            data: [],
        });
    }
}
