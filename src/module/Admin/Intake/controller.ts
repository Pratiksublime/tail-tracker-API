
import { Prisma } from "@prisma/client";
import { Request, Response } from "express";
import { prisma } from "../../../lib/prisma";
import { parseCoordinates, parseOptionalInt } from "../../../utils/parseHelper";
// import { redisClient } from "../../../lib/redis";

const STATUS_ACTIVE = Number(process.env.STATUS_ACTIVE);
const STATUS_DELETED = Number(process.env.STATUS_DELETED);
const ADMIN_INTAKE_ROLES = new Set(["SHELTER_STAFF", "SHELTER_MANAGER", "NGO_ADMIN", "GOVT_ADMIN", "SUPER_ADMIN"]);
const PHOTO_BASE_URL = String(
    process.env.PHOTO_BASE_URL || process.env.COMPANY_WEBSITE_URL || ""
).replace(/\/$/, "");

const withEnvPhotoBaseUrl = (photoUrl: string | null | undefined) => {
    if (!photoUrl) return photoUrl || null;
    if (!PHOTO_BASE_URL) return photoUrl;

    // keep path, swap host/base to env-configured base URL
    const match = photoUrl.match(/(\/uploads\/dogs\/.+)$/);
    if (match?.[1]) return `${PHOTO_BASE_URL}${match[1]}`;
    return photoUrl;
};


// export const workflowList = async (req: Request, res: Response): Promise<void> => {
//     const { role } = (req as any).tokenData || {};
//     // if (!ADMIN_INTAKE_ROLES.has(String(role || ""))) {
//     //     res.status(403).json({ success: false, message: "Forbidden", data: [] });
//     //     return;
//     // }

//     const type = String(req.query.type || "all").toLowerCase(); // new | existing | all
//     const shelterId = parseOptionalInt(req.query.shelterId);
//     const includePhotos = String(req.query.includePhotos || "true").toLowerCase() !== "false";
//     const page = Math.max(1, Number(req.query.page || 1));
//     const limit = Math.min(1000, Math.max(1, Number(req.query.limit || 100)));
//     const skip = (page - 1) * limit;

//     if (!["new", "existing", "all"].includes(type)) {
//         res.status(422).json({
//             success: false,
//             message: "Validation failed",
//             data: { type: ["type must be one of new, existing, all"] },
//         });
//         return;
//     }

//     try {
//         const where: any = {
//             status: { not: STATUS_DELETED },
//             ...(shelterId !== null ? { shelterId } : {}),
//             ...(type === "new"
//                 ? { qrCode: null }
//                 : type === "existing"
//                     ? { qrCode: { not: null } }
//                     : {}),
//         };

//         const [total, dogs] = await Promise.all([
//             prisma.dog.count({ where }),
//             prisma.dog.findMany({
//                 where,
//                 orderBy: { id: "desc" },
//                 skip,
//                 take: limit,
//                 include: includePhotos
//                     ? {
//                         photos: {
//                             orderBy: { capturedAt: "desc" },
//                             take: 1,
//                         },
//                     }
//                     : undefined,
//             }),
//         ]);

//         const ids = dogs.map((d: any) => d.id);
//         const geoMap = new Map<number, { latitude: number | null; longitude: number | null }>();
//         if (ids.length > 0) {
//             const geoRows = await prisma.$queryRaw<Array<{ id: number; latitude: number | null; longitude: number | null }>>(
//                 Prisma.sql`
//                     SELECT
//                         id,
//                         ST_Y(rescue_location::geometry) AS latitude,
//                         ST_X(rescue_location::geometry) AS longitude
//                     FROM dogs
//                     WHERE id IN (${Prisma.join(ids)})
//                 `
//             );

//             geoRows.forEach((row) => {
//                 geoMap.set(row.id, {
//                     latitude: row.latitude !== null ? Number(row.latitude) : null,
//                     longitude: row.longitude !== null ? Number(row.longitude) : null,
//                 });
//             });
//         }

//         const normalizeQr = (value: string) => value.toUpperCase().replace(/-/g, "");

//         const qrCodes = dogs
//             .map((d: any) => (d.qrCode ? String(d.qrCode).toUpperCase() : ""))
//             .filter((v: string) => v.length > 0);
//         const compactCodes = qrCodes.map((v: string) => normalizeQr(v));
//         const tagPayloadMap = new Map<string, string>();

//         if (compactCodes.length > 0) {
//             const tags = await prisma.tag.findMany({
//                 where: {
//                     OR: [
//                         { codeCompact: { in: compactCodes } },
//                         { code: { in: qrCodes } },
//                     ],
//                 },
//                 select: {
//                     code: true,
//                     codeCompact: true,
//                     qrPayload: true,
//                 },
//             });

//             tags.forEach((tag) => {
//                 const codeCompactKey = tag.codeCompact ? normalizeQr(String(tag.codeCompact)) : "";
//                 const codeKey = tag.code ? normalizeQr(String(tag.code)) : "";
//                 if (codeCompactKey) tagPayloadMap.set(codeCompactKey, tag.qrPayload);
//                 if (codeKey) tagPayloadMap.set(codeKey, tag.qrPayload);
//             });
//         }

//         const finalData = dogs.map((d: any) => {
//             const qrCode = d.qrCode ? String(d.qrCode) : null;
//             const qrKey = qrCode ? normalizeQr(qrCode) : "";
//             return {
//                 id: d.id,
//                 tempId: d.tempId,
//                 qrCode: d.qrCode,
//                 qrPayload: qrKey ? (tagPayloadMap.get(qrKey) || null) : null,
//                 shelterId: d.shelterId,
//                 lifecycleState: d.lifecycleState,
//                 lifecyclePhase: d.lifecyclePhase,
//                 intakeCondition: d.intakeCondition,
//                 rescueLocation: geoMap.has(d.id) ? geoMap.get(d.id) : null,
//                 isSterilized: d.isSterilized,
//                 updatedAt: d.updatedAt,
//                 latestPhoto: includePhotos ? (d.photos?.[0] || null) : null,
//                 dogType: d.qrCode ? "existing" : "new",
//                 qrCodeAssignedBy: d.qrCode ? d.qrAssignedBy : null,
//             };
//         });


//         res.status(200).json({
//             success: true,
//             message: "Workflow list fetched",
//             data: finalData,
//             pagination: {
//                 page,
//                 limit,
//                 total,
//                 totalPages: Math.max(1, Math.ceil(total / limit)),
//             },
//         });
//     } catch (error) {
//         res.status(500).json({
//             success: false,
//             message: "Failed to fetch workflow list",
//             data: [],
//         });
//     }
// }

export const workflowList = async (req: Request, res: Response): Promise<void> => {
    const { role } = (req as any).tokenData || {};
    // if (!ADMIN_INTAKE_ROLES.has(String(role || ""))) {
    //     res.status(403).json({ success: false, message: "Forbidden", data: [] });
    //     return;
    // }

    const type = String(req.query.type || "all").toLowerCase(); // new | existing | all
    const section = String(req.query.section || "intake").toLowerCase(); // intake | operation | release | all
    const shelterId = parseOptionalInt(req.query.shelterId);
    const includePhotos = String(req.query.includePhotos || "true").toLowerCase() !== "false";
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit || 100)));
    const skip = (page - 1) * limit;

    if (!["new", "existing", "all"].includes(type)) {
        res.status(422).json({
            success: false,
            message: "Validation failed",
            data: { type: ["type must be one of new, existing, all"] },
        });
        return;
    }

    if (!["intake", "operation", "release", "all"].includes(section)) {
        res.status(422).json({
            success: false,
            message: "Validation failed",
            data: { section: ["section must be one of intake, operation, release, all"] },
        });
        return;
    }

    try {
        const where: any = {
            status: { not: STATUS_DELETED },
            // ...(shelterId !== null ? { shelterId } : {}),
            ...(type === "new"
                ? { qrCode: null }
                : type === "existing"
                    ? { qrCode: { not: null } }
                    : {}),
        };

        // Section-wise filtering for tab-based data
        if (section === "operation") {
            Object.assign(where, {
                qrCode: { not: null },
                lifecyclePhase: { not: "FINAL_DISPOSITION" },
                lifecycleState: { notIn: ["READY_FOR_RELEASE", "RELEASED"] },
            });
        } else if (section === "release") {
            Object.assign(where, {
                qrCode: { not: null },
                OR: [
                    { lifecyclePhase: "FINAL_DISPOSITION" },
                    { lifecycleState: "READY_FOR_RELEASE" },
                    { lifecycleState: "RELEASED" },
                ],
            });
        } else if (section === "intake") {
            // Intake section: exclude release/final-disposition data
            Object.assign(where, {
                lifecycleState: "IN_TRANSIT",
                // NOT: [
                //     { lifecyclePhase: "INTAKE_IDENTIFICATION" },
                //     { lifecyclePhase: "FINAL_DISPOSITION" },
                //     { lifecycleState: "READY_FOR_RELEASE" },
                //     { lifecycleState: "RELEASED" },
                //     { lifecycleState: "AWAITING_IDENTIFICATION" },
                // ],
            });
        }
        // section === "all": keep base/type filters only

        const [total, dogs] = await Promise.all([
            prisma.dog.count({ where }),
            prisma.dog.findMany({
                where,
                orderBy: { id: "desc" },
                skip,
                take: limit,
                include: includePhotos
                    ? {
                        photos: {
                            orderBy: { capturedAt: "desc" },
                            take: 1,
                        },
                    }
                    : undefined,
            }),
        ]);

        const ids = dogs.map((d: any) => d.id);
        const geoMap = new Map<number, { latitude: number | null; longitude: number | null }>();

        if (ids.length > 0) {
            const geoRows = await prisma.$queryRaw<Array<{ id: number; latitude: number | null; longitude: number | null }>>(
                Prisma.sql`
                    SELECT
                        id,
                        ST_Y(rescue_location::geometry) AS latitude,
                        ST_X(rescue_location::geometry) AS longitude
                    FROM dogs
                    WHERE id IN (${Prisma.join(ids)})
                `
            );

            geoRows.forEach((row) => {
                geoMap.set(row.id, {
                    latitude: row.latitude !== null ? Number(row.latitude) : null,
                    longitude: row.longitude !== null ? Number(row.longitude) : null,
                });
            });
        }

        const normalizeQr = (value: string) => value.toUpperCase().replace(/-/g, "");

        const qrCodes = dogs
            .map((d: any) => (d.qrCode ? String(d.qrCode).toUpperCase() : ""))
            .filter((v: string) => v.length > 0);

        const compactCodes = qrCodes.map((v: string) => normalizeQr(v));
        const tagPayloadMap = new Map<string, string>();

        if (compactCodes.length > 0) {
            const tags = await prisma.tag.findMany({
                where: {
                    OR: [
                        { codeCompact: { in: compactCodes } },
                        { code: { in: qrCodes } },
                    ],
                },
                select: {
                    code: true,
                    codeCompact: true,
                    qrPayload: true,
                },
            });

            tags.forEach((tag) => {
                const codeCompactKey = tag.codeCompact ? normalizeQr(String(tag.codeCompact)) : "";
                const codeKey = tag.code ? normalizeQr(String(tag.code)) : "";
                if (codeCompactKey) tagPayloadMap.set(codeCompactKey, tag.qrPayload);
                if (codeKey) tagPayloadMap.set(codeKey, tag.qrPayload);
            });
        }

        const finalData = dogs.map((d: any) => {
            const qrCode = d.qrCode ? String(d.qrCode) : null;
            const qrKey = qrCode ? normalizeQr(qrCode) : "";
            const behavioralNotes = String(d.behavioralNotes || "");

            const hasSterRecord = behavioralNotes.includes("[STERILIZATION_RECORD]");
            const hasVaccRecord = behavioralNotes.includes("[VACCINATION_RECORD]");
            const sterilizationDone = Boolean(d.isSterilized || hasSterRecord);
            const vaccinationLogged = Boolean(hasVaccRecord);
            const readyForRelease = d.lifecycleState === "READY_FOR_RELEASE" || d.lifecycleState === "RELEASED";

            return {
                id: d.id,
                tempId: d.tempId,
                qrCode: d.qrCode,
                qrPayload: qrKey ? (tagPayloadMap.get(qrKey) || null) : null,
                shelterId: d.shelterId,
                lifecycleState: d.lifecycleState,
                lifecyclePhase: d.lifecyclePhase,
                intakeCondition: d.intakeCondition,
                rescueLocation: geoMap.has(d.id) ? geoMap.get(d.id) : null,
                isSterilized: d.isSterilized,
                intakeDate: d.intakeDate || d.createdAt || null,
                releaseDate: d.releaseDate || null,
                vaccinationLogged,
                updatedAt: d.updatedAt,
                latestPhoto: includePhotos ? (d.photos?.[0] || null) : null,
                dogType: d.qrCode ? "existing" : "new",
                qrCodeAssignedBy: d.qrCode ? d.qrAssignedBy : null,
                workflow: {
                    sterilizationDone,
                    vaccinationLogged,
                    readyForRelease,
                },
            };
        });

        res.status(200).json({
            success: true,
            message: "Workflow list fetched",
            data: finalData,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.max(1, Math.ceil(total / limit)),
            },
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to fetch workflow list",
            data: [],
        });
    }
};




// export const updateDogProcessingStatus = async (req: Request, res: Response): Promise<void> => {
//     const { userId, role } = (req as any).tokenData || {};
//     const payload = (req.body && typeof req.body === "object") ? req.body : {};
//     const dogId = parseOptionalInt((payload as any).dogId);
//     const qrCodeInput = typeof (payload as any).qrCode === "string" ? String((payload as any).qrCode).trim() : "";
//     const step = String((payload as any).step || "").trim().toUpperCase();

//     // if (!ADMIN_INTAKE_ROLES.has(String(role || ""))) {
//     //     res.status(403).json({ success: false, message: "Forbidden", data: [] });
//     //     return;
//     // }

//     if (!qrCodeInput && dogId) {
//         res.status(422).json({
//             success: false,
//             message: "Provide qrCode Or assign qrCode to dog",
//             data: { qrCode: ["Provide qrCode"] },
//         });
//         return;
//     }

//     if (!["STERILIZATION", "VACCINATION", "READY_FOR_RELEASE"].includes(step)) {
//         res.status(422).json({
//             success: false,
//             message: "Validation failed",
//             data: { step: ["step must be one of STERILIZATION, VACCINATION, READY_FOR_RELEASE"] },
//         });
//         return;
//     }

//     if (dogId === null && !qrCodeInput) {
//         res.status(422).json({
//             success: false,
//             message: "Validation failed",
//             data: { identity: ["Provide dogId or qrCode"] },
//         });
//         return;
//     }

//     try {
//         let dog = await prisma.dog.findFirst({
//             where: {
//                 status: { not: STATUS_DELETED },
//                 ...(dogId !== null ? { id: dogId } : {}),
//                 ...(dogId === null && qrCodeInput ? { qrCode: qrCodeInput } : {}),
//             },
//             select: {
//                 id: true,
//                 tempId: true,
//                 qrCode: true,
//                 qrAssignedAt: true,
//                 isSterilized: true,
//                 behavioralNotes: true,
//                 lifecycleState: true,
//                 lifecyclePhase: true,
//             },
//         });

//         if (!dog) {
//             res.status(404).json({ success: false, message: "Dog not found", data: [] });
//             return;
//         }
//         const resolvedDog = dog;

//         const updateData: any = { updatedAt: new Date() };
//         const effectiveQr = qrCodeInput || resolvedDog.qrCode || "";

//         // Allow QR assignment in same call, but uniqueness enforced.
//         if (qrCodeInput && qrCodeInput !== resolvedDog.qrCode) {
//             const existingWithQr = await prisma.dog.findFirst({
//                 where: { qrCode: qrCodeInput, id: { not: resolvedDog.id }, status: { not: STATUS_DELETED } },
//                 select: { id: true, tempId: true },
//             });
//             if (existingWithQr) {
//                 res.status(409).json({
//                     success: false,
//                     message: "qrCode is already assigned to another dog",
//                     data: [{ dogId: existingWithQr.id, tempId: existingWithQr.tempId }],
//                 });
//                 return;
//             }
//             updateData.qrCode = qrCodeInput;
//             updateData.qrAssignedAt = new Date();
//         }

//         if (!effectiveQr && step !== "READY_FOR_RELEASE") {
//             res.status(422).json({
//                 success: false,
//                 message: "Validation failed",
//                 data: { qrCode: ["Dog must be tagged (qrCode assigned) before medical workflow"] },
//             });
//             return;
//         }

//         const existingNotes = String(resolvedDog.behavioralNotes || "");
//         const hasSterRecord = existingNotes.includes("[STERILIZATION_RECORD]");
//         const hasVaccRecord = existingNotes.includes("[VACCINATION_RECORD]");

//         const pushNote = (recordType: "STERILIZATION_RECORD" | "VACCINATION_RECORD", recordData: Record<string, any>) => {
//             const stamp = (payload as any).dateOfUpdate || new Date().toISOString();
//             const block = `[${recordType}] ${JSON.stringify({ ...recordData, updatedAt: stamp, updatedByUserId: userId })}`;
//             updateData.behavioralNotes = existingNotes
//                 ? `${existingNotes}\n${block}`
//                 : block;
//         };

//         if (step === "STERILIZATION") {
//             const sterilizationStatus = String((payload as any).sterilizationStatus || "").toLowerCase();
//             const sterilizationDate = String((payload as any).sterilizationDate || "");
//             const sterilizationType = String((payload as any).sterilizationType || "").toUpperCase();
//             const identificationMark = String((payload as any).identificationMark || "").toUpperCase();
//             const recordedBy = String((payload as any).recordedBy || "").trim();

//             const validSterType = ["SPAY", "NEUTER"].includes(sterilizationType);
//             const validMark = ["EAR_NOTCH", "TATTOO", "NONE"].includes(identificationMark);
//             const done = sterilizationStatus === "yes" || sterilizationStatus === "true";

//             if (!done || !sterilizationDate || !validSterType || !validMark || !recordedBy) {
//                 res.status(422).json({
//                     success: false,
//                     message: "Validation failed",
//                     data: {
//                         sterilization: [
//                             "Required: sterilizationStatus=Yes, sterilizationDate,  sterilizationType(SPAY/NEUTER), identificationMark(EAR_NOTCH/TATTOO/NONE), recordedBy",
//                         ],
//                     },
//                 });
//                 return;
//             }

//             updateData.isSterilized = true;
//             pushNote("STERILIZATION_RECORD", {
//                 qrCode: effectiveQr,
//                 sterilizationStatus: "YES",
//                 sterilizationDate,
//                 sterilizationType,
//                 identificationMark,
//                 recordedBy,
//             });
//         } else if (step === "VACCINATION") {
//             if (!resolvedDog.isSterilized && !hasSterRecord) {
//                 res.status(422).json({
//                     success: false,
//                     message: "Validation failed",
//                     data: { sequence: ["Sterilization must be completed before vaccination"] },
//                 });
//                 return;
//             }

//             const vaccineName = String((payload as any).vaccineName || "").trim();
//             const vaccinationDate = String((payload as any).vaccinationDate || "");
//             const nextDueDate = (payload as any).nextDueDate ? String((payload as any).nextDueDate) : null;
//             const batchNumber = (payload as any).batchNumber ? String((payload as any).batchNumber) : null;
//             const inputMethod = String((payload as any).inputMethod || "").toUpperCase();
//             const recordedBy = String((payload as any).recordedBy || "").trim();

//             if (!vaccineName || !vaccinationDate || inputMethod !== "MANUAL" || !recordedBy) {
//                 res.status(422).json({
//                     success: false,
//                     message: "Validation failed",
//                     data: {
//                         vaccination: [
//                             "Required: vaccineName, vaccinationDate, inputMethod=MANUAL, recordedBy",
//                         ],
//                     },
//                 });
//                 return;
//             }

//             pushNote("VACCINATION_RECORD", {
//                 qrCode: effectiveQr,
//                 vaccineName,
//                 vaccinationDate,
//                 nextDueDate,
//                 batchNumber,
//                 inputMethod,
//                 recordedBy,
//             });
//         } else if (step === "READY_FOR_RELEASE") {
//             if (!effectiveQr) {
//                 res.status(422).json({
//                     success: false,
//                     message: "Validation failed",
//                     data: { qrCode: ["QR code must be assigned before READY_FOR_RELEASE"] },
//                 });
//                 return;
//             }
//             if ((!resolvedDog.isSterilized && !hasSterRecord) || !hasVaccRecord) {
//                 res.status(422).json({
//                     success: false,
//                     message: "Validation failed",
//                     data: { sequence: ["Complete Sterilization and Vaccination before READY_FOR_RELEASE"] },
//                 });
//                 return;
//             }

//             updateData.lifecycleState = "READY_FOR_RELEASE";
//             updateData.lifecyclePhase = "FINAL_DISPOSITION";
//         }

//         const updated = await prisma.dog.update({
//             where: { id: resolvedDog.id },
//             data: updateData,
//         });

//         res.status(200).json({
//             success: true,
//             message: `Dog ${step.toLowerCase()} updated successfully`,
//             data: [{
//                 dog: updated,
//                 workflow: {
//                     step,
//                     hasQrCode: Boolean(updated.qrCode),
//                     sterilizationDone: Boolean(updated.isSterilized || hasSterRecord),
//                     vaccinationLogged: step === "VACCINATION" || hasVaccRecord || String(updateData.behavioralNotes || "").includes("[VACCINATION_RECORD]"),
//                     readyForRelease: updated.lifecycleState === "READY_FOR_RELEASE",
//                 },
//             }],
//         });
//     } catch (error: any) {
//         res.status(500).json({
//             success: false,
//             message: error?.message || "Failed to update dog processing status",
//             data: [],
//         });
//     }
// }


export const updateDogProcessingStatus = async (req: Request, res: Response): Promise<void> => {
    const { userId, role } = (req as any).tokenData || {};
    const payload = (req.body && typeof req.body === "object") ? req.body : {};

    const dogId = parseOptionalInt((payload as any).dogId);
    const qrCodeInput = typeof (payload as any).qrCode === "string" ? String((payload as any).qrCode).trim() : "";
    const step = String((payload as any).step || "").trim().toUpperCase();

    // if (!ADMIN_INTAKE_ROLES.has(String(role || ""))) {
    //   res.status(403).json({ success: false, message: "Forbidden", data: [] });
    //   return;
    // }

    if (!["STERILIZATION", "VACCINATION", "READY_FOR_RELEASE", "MOVE_TO_OPERATION"].includes(step)) {
        res.status(422).json({
            success: false,
            message: "Validation failed",
            data: { step: ["step must be one of MOVE_TO_OPERATION, STERILIZATION, VACCINATION, READY_FOR_RELEASE"] },
        });
        return;
    }

    if (dogId === null && !qrCodeInput) {
        res.status(422).json({
            success: false,
            message: "Validation failed",
            data: { identity: ["Provide dogId or qrCode"] },
        });
        return;
    }

    try {
        const dog = await prisma.dog.findFirst({
            where: {
                status: { not: STATUS_DELETED },
                ...(dogId !== null ? { id: dogId } : {}),
                ...(dogId === null && qrCodeInput ? { qrCode: qrCodeInput } : {}),
            },
            select: {
                id: true,
                tempId: true,
                qrCode: true,
                qrAssignedAt: true,
                isSterilized: true,
                behavioralNotes: true,
                lifecycleState: true,
                lifecyclePhase: true,
            },
        });

        if (!dog) {
            res.status(404).json({ success: false, message: "Dog not found", data: [] });
            return;
        }

        const resolvedDog = dog;
        const updateData: any = { updatedAt: new Date() };

        let effectiveQr = qrCodeInput || resolvedDog.qrCode || "";

        // Allow QR assignment in same call, uniqueness enforced.
        if (qrCodeInput && qrCodeInput !== resolvedDog.qrCode) {
            const existingWithQr = await prisma.dog.findFirst({
                where: {
                    qrCode: qrCodeInput,
                    id: { not: resolvedDog.id },
                    status: { not: STATUS_DELETED },
                },
                select: { id: true, tempId: true },
            });

            if (existingWithQr) {
                res.status(409).json({
                    success: false,
                    message: "qrCode is already assigned to another dog",
                    data: [{ dogId: existingWithQr.id, tempId: existingWithQr.tempId }],
                });
                return;
            }

            updateData.qrCode = qrCodeInput;
            updateData.qrAssignedAt = new Date();
            effectiveQr = qrCodeInput;
        }

        if (!effectiveQr && step !== "READY_FOR_RELEASE") {
            res.status(422).json({
                success: false,
                message: "Validation failed",
                data: { qrCode: ["Dog must be tagged (qrCode assigned) before medical workflow"] },
            });
            return;
        }

        const existingNotes = String(resolvedDog.behavioralNotes || "");
        let notesBuffer = existingNotes;

        const hasSterYesRecord = (text: string) =>
            text.includes("[STERILIZATION_RECORD]") && text.includes("\"sterilizationStatus\":\"YES\"");

        const hasVaccRecord = (text: string) => text.includes("[VACCINATION_RECORD]");

        const appendNote = (
            recordType: "STERILIZATION_RECORD" | "VACCINATION_RECORD",
            recordData: Record<string, any>
        ) => {
            const block = `[${recordType}] ${JSON.stringify({
                ...recordData,
                updatedAt: new Date().toISOString(),
                updatedByUserId: userId,
            })}`;
            notesBuffer = notesBuffer ? `${notesBuffer}\n${block}` : block;
            updateData.behavioralNotes = notesBuffer;
        };

        if (step === "MOVE_TO_OPERATION") {
            updateData.lifecycleState = "AWAITING_IDENTIFICATION";
            updateData.lifecyclePhase = "INTAKE_IDENTIFICATION";
        } else if (step === "STERILIZATION") {
            const sterilizationStatus = String((payload as any).sterilizationStatus || "").trim().toUpperCase();
            const sterilizationDate = String((payload as any).sterilizationDate || "").trim();
            const sterilizationType = String((payload as any).sterilizationType || "").trim().toUpperCase();
            const identificationMark = String((payload as any).identificationMark || "").trim().toUpperCase();
            const recordedBy = String((payload as any).recordedBy || "").trim();

            if (!["YES", "NO"].includes(sterilizationStatus)) {
                res.status(422).json({
                    success: false,
                    message: "Validation failed",
                    data: { sterilizationStatus: ["sterilizationStatus must be YES or NO"] },
                });
                return;
            }

            if (sterilizationStatus === "YES") {
                const validSterType = ["SPAY", "NEUTER"].includes(sterilizationType);
                const validMark = ["EAR_NOTCH", "TATTOO", "NONE", "OTHER"].includes(identificationMark);

                if (!sterilizationDate || !validSterType || !validMark || !recordedBy) {
                    res.status(422).json({
                        success: false,
                        message: "Validation failed",
                        data: {
                            sterilization: [
                                "Required for YES: sterilizationDate, sterilizationType(SPAY/NEUTER), identificationMark(EAR_NOTCH/TATTOO/NONE/OTHER), recordedBy",
                            ],
                        },
                    });
                    return;
                }

                updateData.isSterilized = true;
                appendNote("STERILIZATION_RECORD", {
                    qrCode: effectiveQr,
                    sterilizationStatus: "YES",
                    sterilizationDate,
                    sterilizationType,
                    identificationMark,
                    recordedBy,
                });
            } else {
                // NO -> explicitly store negative status and mark as not sterilized
                updateData.isSterilized = false;
                appendNote("STERILIZATION_RECORD", {
                    qrCode: effectiveQr,
                    sterilizationStatus: "NO",
                    sterilizationDate: null,
                    sterilizationType: null,
                    identificationMark: null,
                    recordedBy: recordedBy || null,
                });
            }
        } else if (step === "VACCINATION") {
            const sterilizationDoneNow = Boolean(
                updateData.isSterilized === true ||
                resolvedDog.isSterilized ||
                hasSterYesRecord(notesBuffer)
            );

            if (!sterilizationDoneNow) {
                res.status(422).json({
                    success: false,
                    message: "Validation failed",
                    data: { sequence: ["Sterilization must be completed before vaccination"] },
                });
                return;
            }

            const allowedVaccines = new Set(["ARV", "D", "H", "A2", "P", "PI", "L"]);
            const vaccineName = String((payload as any).vaccineName || "").trim().toUpperCase();
            const vaccinationDate = String((payload as any).vaccinationDate || "").trim();
            const batchNumber = (payload as any).batchNumber ? String((payload as any).batchNumber).trim() : null;
            const recordedBy = String((payload as any).recordedBy || "").trim();

            if (!vaccineName || !allowedVaccines.has(vaccineName) || !vaccinationDate || !recordedBy) {
                res.status(422).json({
                    success: false,
                    message: "Validation failed",
                    data: {
                        vaccination: [
                            "Required: vaccineName(ARV/D/H/A2/P/PI/L), vaccinationDate, recordedBy",
                        ],
                    },
                });
                return;
            }

            appendNote("VACCINATION_RECORD", {
                qrCode: effectiveQr,
                vaccineName,
                vaccinationDate,
                batchNumber,
                recordedBy,
                isFutureDose: false,
            });

            const futureVaccinations = Array.isArray((payload as any).futureVaccinations)
                ? (payload as any).futureVaccinations
                : [];

            if (futureVaccinations.length > 5) {
                res.status(422).json({
                    success: false,
                    message: "Validation failed",
                    data: { futureVaccinations: ["Maximum 5 future vaccinations allowed"] },
                });
                return;
            }

            for (let i = 0; i < futureVaccinations.length; i += 1) {
                const item = futureVaccinations[i] || {};
                const fvName = String(item.vaccineName || "").trim().toUpperCase();
                const fvDate = String(item.vaccinationDate || "").trim();

                if (!fvName || !allowedVaccines.has(fvName) || !fvDate) {
                    res.status(422).json({
                        success: false,
                        message: "Validation failed",
                        data: {
                            futureVaccinations: [
                                `Invalid future vaccination at index ${i}. Required: vaccineName(ARV/D/H/A2/P/PI/L), vaccinationDate`,
                            ],
                        },
                    });
                    return;
                }

                appendNote("VACCINATION_RECORD", {
                    qrCode: effectiveQr,
                    vaccineName: fvName,
                    vaccinationDate: fvDate,
                    batchNumber: null,
                    recordedBy,
                    isFutureDose: true,
                    sequence: i + 1,
                });
            }
        } else if (step === "READY_FOR_RELEASE") {
            if (!effectiveQr) {
                res.status(422).json({
                    success: false,
                    message: "Validation failed",
                    data: { qrCode: ["QR code must be assigned before READY_FOR_RELEASE"] },
                });
                return;
            }

            const sterilizationDoneNow = Boolean(
                updateData.isSterilized === true ||
                resolvedDog.isSterilized ||
                hasSterYesRecord(notesBuffer)
            );
            const vaccinationLoggedNow = hasVaccRecord(notesBuffer);

            if (!sterilizationDoneNow || !vaccinationLoggedNow) {
                res.status(422).json({
                    success: false,
                    message: "Validation failed",
                    data: { sequence: ["Complete Sterilization and Vaccination before READY_FOR_RELEASE"] },
                });
                return;
            }

            updateData.lifecycleState = "READY_FOR_RELEASE";
            updateData.lifecyclePhase = "FINAL_DISPOSITION";
        }
        console.log("updateData", updateData)
        const updated = await prisma.dog.update({
            where: { id: resolvedDog.id },
            data: updateData,
        });

        const finalNotes = String(updated.behavioralNotes || notesBuffer || "");
        const workflow = {
            step,
            hasQrCode: Boolean(updated.qrCode),
            sterilizationDone: Boolean(updated.isSterilized || hasSterYesRecord(finalNotes)),
            vaccinationLogged: Boolean(hasVaccRecord(finalNotes)),
            readyForRelease: updated.lifecycleState === "READY_FOR_RELEASE" || updated.lifecycleState === "RELEASED",
        };

        res.status(200).json({
            success: true,
            message: `Dog ${step.toLowerCase()} updated successfully`,
            data: [
                {
                    dog: updated,
                    workflow,
                },
            ],
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: error?.message || "Failed to update dog processing status",
            data: [],
        });
    }
};


export const releaseList = async (req: Request, res: Response): Promise<void> => {
    try {
        const shelterId = parseOptionalInt(req.query.shelterId);
        const includePhotos = String(req.query.includePhotos || "true").toLowerCase() !== "false";
        const dogs = await prisma.dog.findMany({
            where: {
                status: { not: STATUS_DELETED },
                lifecycleState: "READY_FOR_RELEASE",
                // ...(shelterId !== null ? { shelterId } : {}),
            },
            orderBy: { updatedAt: "desc" },
            include: includePhotos
                ? {
                    photos: {
                        orderBy: { capturedAt: "desc" },
                        take: 1,
                    },
                }
                : undefined,
        });

        const ids = dogs.map((d: any) => d.id);
        const geoMap = new Map<number, { latitude: number | null; longitude: number | null }>();
        if (ids.length > 0) {
            const geoRows = await prisma.$queryRaw<Array<{ id: number; latitude: number | null; longitude: number | null }>>(
                Prisma.sql`
                    SELECT
                        id,
                        ST_Y(rescue_location::geometry) AS latitude,
                        ST_X(rescue_location::geometry) AS longitude
                    FROM dogs
                    WHERE id IN (${Prisma.join(ids)})
                `
            );

            geoRows.forEach((row) => {
                geoMap.set(row.id, {
                    latitude: row.latitude !== null ? Number(row.latitude) : null,
                    longitude: row.longitude !== null ? Number(row.longitude) : null,
                });
            });
        }

        res.status(200).json({
            success: true,
            message: "Release list fetched",
            data: dogs.map((d: any) => ({
                id: d.id,
                tempId: d.tempId,
                qrCode: d.qrCode,
                shelterId: d.shelterId,
                lifecycleState: d.lifecycleState,
                lifecyclePhase: d.lifecyclePhase,
                isSterilized: d.isSterilized,
                rescueLocation: geoMap.has(d.id) ? geoMap.get(d.id) : null,
                rescueAddress: d.rescueAddress,
                updatedAt: d.updatedAt,
                latestPhoto: includePhotos ? (d.photos?.[0] || null) : null,
            })),
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to fetch release list", data: [] });
    }
}

export const releaseDogs = async (req: Request, res: Response): Promise<void> => {
    const { role } = (req as any).tokenData || {};
    if (role !== "FIELD_TECH") {
        res.status(403).json({ success: false, message: "Forbidden", data: [] });
        return;
    }

    const payload = (req.body && typeof req.body === "object") ? req.body : {};
    const items = Array.isArray((payload as any).items)
        ? (payload as any).items
        : (payload as any).dogId !== undefined
            ? [payload]
            : [];

    if (!items.length) {
        res.status(422).json({
            success: false,
            message: "Validation failed",
            data: { items: ["Provide items[] or single payload with dogId + releaseLocation"] },
        });
        return;
    }

    const successItems: Array<{ index: number; dogId: number }> = [];
    const failedItems: Array<{ index: number; dogId?: number; reason: string }> = [];

    for (let i = 0; i < items.length; i++) {
        const item = items[i] || {};
        const dogId = parseOptionalInt(item.dogId);
        const parsedLocation = parseCoordinates(item.releaseLocation ?? item.rescueLocation, null, null);

        if (dogId === null) {
            failedItems.push({ index: i, reason: "Invalid dogId" });
            continue;
        }
        if (parsedLocation === null) {
            failedItems.push({ index: i, dogId, reason: "Invalid releaseLocation" });
            continue;
        }

        try {
            const existing = await prisma.dog.findFirst({
                where: { id: dogId, status: { not: STATUS_DELETED } },
                select: { id: true },
            });
            if (!existing) {
                failedItems.push({ index: i, dogId, reason: "Dog not found" });
                continue;
            }

            await prisma.$executeRaw`
                UPDATE dogs
                SET lifecycle_state = ${"RELEASED"}::"LifecycleState",
                    lifecycle_phase = ${"FINAL_DISPOSITION"}::"LifecyclePhase",
                    rescue_location = ST_SetSRID(ST_MakePoint(${parsedLocation.longitude}, ${parsedLocation.latitude}), 4326),
                    rescue_address = ${item.releaseAddress ?? null},
                    updated_at = NOW()
                WHERE id = ${dogId};
            `;

            successItems.push({ index: i, dogId });
        } catch (error: any) {
            failedItems.push({ index: i, dogId, reason: error?.message || "Database error" });
        }
    }

    res.status(failedItems.length ? 207 : 200).json({
        success: failedItems.length === 0,
        message: failedItems.length ? "Release processed with partial failures" : "Release processed successfully",
        data: {
            summary: {
                total: items.length,
                successCount: successItems.length,
                failedCount: failedItems.length,
            },
            successItems,
            failedItems,
        },
    });
}

export const getDogDetailsByQrCode = async (req: Request, res: Response): Promise<void> => {
    try {
        const payload = (req.body && typeof req.body === "object") ? req.body : {};
        const qrInputRaw = String(
            (payload as any).qrCode
            || (payload as any).qrPayload
            || req.query.qrCode
            || req.query.qrPayload
            || ""
        ).trim();

        if (!qrInputRaw) {
            res.status(422).json({
                success: false,
                message: "Validation failed",
                data: { qrCode: ["qrCode or qrPayload is required"] },
            });
            return;
        }

        const normalizedInput = qrInputRaw.toUpperCase();
        const compactFromInput = normalizedInput
            .replace(/.*\/T\//i, "")
            .replace(/-/g, "")
            .trim();

        const tag = await prisma.tag.findFirst({
            where: {
                OR: [
                    { code: normalizedInput },
                    { codeCompact: compactFromInput },
                    { qrPayload: qrInputRaw },
                ],
            },
            select: {
                id: true,
                code: true,
                codeCompact: true,
                qrPayload: true,
                assignedDog: true,
                isAssigned: true,
                assignedAt: true,
                batch: {
                    select: {
                        id: true,
                        prefix: true,
                    },
                },
            },
        });

        const dogWhere: any = {
            status: { not: STATUS_DELETED },
        };

        if (tag?.assignedDog) {
            dogWhere.id = tag.assignedDog;
        } else {
            dogWhere.OR = [
                { qrCode: qrInputRaw },
                { qrCode: normalizedInput },
                { qrCode: compactFromInput },
                ...(tag?.code ? [{ qrCode: tag.code }] : []),
                ...(tag?.codeCompact ? [{ qrCode: tag.codeCompact }] : []),
            ];
        }

        const dog = await prisma.dog.findFirst({
            where: dogWhere,
            include: {
                photos: { orderBy: { capturedAt: "desc" } },
                shelter: {
                    select: {
                        id: true,
                        name: true,
                        code: true,
                    },
                },
            },
        });

        if (!dog) {
            res.status(404).json({
                success: false,
                message: "Dog not found for provided QR",
                data: [],
            });
            return;
        }

        const geoRows = await prisma.$queryRaw<Array<{ latitude: number | null; longitude: number | null }>>(
            Prisma.sql`
                SELECT
                    ST_Y(rescue_location::geometry) AS latitude,
                    ST_X(rescue_location::geometry) AS longitude
                FROM dogs
                WHERE id = ${dog.id}
                LIMIT 1
            `
        );
        const geo = geoRows[0]
            ? {
                latitude: geoRows[0].latitude !== null ? Number(geoRows[0].latitude) : null,
                longitude: geoRows[0].longitude !== null ? Number(geoRows[0].longitude) : null,
            }
            : null;

        res.status(200).json({
            success: true,
            message: "Dog details fetched successfully",
            data: [{
                id: dog.id,
                tempId: dog.tempId,
                qrCode: dog.qrCode,
                rfidTag: dog.rfidTag,
                shelterId: dog.shelterId,
                shelter: dog.shelter,
                profileStatus: dog.profileStatus,
                lifecycleState: dog.lifecycleState,
                lifecyclePhase: dog.lifecyclePhase,
                estimatedAge: dog.estimatedAge,
                sex: dog.sex,
                breed: dog.breed,
                color: dog.color,
                distinguishingMarks: dog.distinguishingMarks,
                intakeCondition: dog.intakeCondition,
                behavioralNotes: dog.behavioralNotes,
                rescueLocation: geo,
                rescueAddress: dog.rescueAddress,
                intakeDate: dog.intakeDate,
                intakeByUserId: dog.intakeByUserId,
                isSterilized: dog.isSterilized,
                qrAssignedAt: dog.qrAssignedAt,
                status: dog.status,
                createdAt: dog.createdAt,
                updatedAt: dog.updatedAt,
                latestPhoto: dog.photos?.[0]
                    ? { ...dog.photos[0], photoUrl: withEnvPhotoBaseUrl(dog.photos[0].photoUrl) }
                    : null,
                photos: (dog.photos || []).map((p: any) => ({
                    ...p,
                    photoUrl: withEnvPhotoBaseUrl(p.photoUrl),
                })),
                tag: tag
                    ? {
                        id: tag.id,
                        code: tag.code,
                        codeCompact: tag.codeCompact,
                        qrPayload: tag.qrPayload,
                        isAssigned: tag.isAssigned,
                        assignedAt: tag.assignedAt,
                        batch: tag.batch,
                    }
                    : null,
            }],
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: error?.message || "Failed to fetch dog details by QR",
            data: [],
        });
    }
}
