
import { PhotoType, Prisma } from "@prisma/client";
import { Request, Response } from "express";
import { UploadedFile } from "express-fileupload";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { prisma } from "../../../lib/prisma";
import { parseCoordinates, parseOptionalInt } from "../../../utils/parseHelper";
import { validate } from "../../../utils/validator";


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

export const capture = async (req: Request, res: Response): Promise<void> => {
    const { userId, role } = (req as any).tokenData
    const {
        id,
        tempId,
        rfidTag,
        shelterId,
        profileStatus,
        lifecycleState,
        lifecyclePhase,
        estimatedAge,
        sex,
        breed,
        color,
        distinguishingMarks,
        intakeCondition,
        behavioralNotes,
        rescueLocation,
        rescueAddress,
        isSterilized,
    } = req.body;

    const dogId = parseOptionalInt(id);
    const isUpdate = dogId !== null;
    const parsedLocation = parseCoordinates(rescueLocation, null, null);

    if (role !== "FIELD_TECH") {
        res.status(403).json({
            success: false,
            message: "Forbidden",
        });
        return;
    }


    if (!isUpdate && parsedLocation === null) {
        res.status(422).json({
            success: false,
            message: "Validation failed",
            data: {
                location: ["Valid latitude/longitude are required for shelter creation."],
            },
        });
        return;
    }

    if (
        isUpdate
        && (location !== undefined)
        && parsedLocation === null
    ) {
        res.status(422).json({
            success: false,
            message: "Validation failed",
            data: { location: ["Invalid latitude/longitude values."] },
        });
        return;
    }

    const validationRules: Record<string, string> = isUpdate
        ? {
            id: "required|integer",
            shelterId: "required|integer",
        }
        : {
            tempId: "required|string",
            intakeCondition: "required|string",
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
        if (isUpdate && dogId !== null) {
            const existingDog = await prisma.dog.findUnique({
                where: {
                    id: dogId,
                    status: STATUS_ACTIVE
                },
            })

            if (!existingDog) {
                res.status(404).json({ success: false, message: "Dog not found" });
                return;
            }

            const updatedData: any = {};
            if (tempId) updatedData.tempId = tempId;
            if (rfidTag) updatedData.rfidTag = rfidTag;
            if (shelterId) updatedData.shelterId = shelterId;
            if (profileStatus) updatedData.profileStatus = profileStatus;
            if (lifecycleState) updatedData.lifecycleState = lifecycleState;
            if (estimatedAge) updatedData.estimatedAge = estimatedAge;
            if (sex) updatedData.sex = sex;
            if (breed) updatedData.breed = breed;
            if (color) updatedData.color = color;
            if (distinguishingMarks) updatedData.distinguishingMarks = distinguishingMarks;
            if (intakeCondition) updatedData.intakeCondition = intakeCondition;
            if (behavioralNotes) updatedData.behavioralNotes = behavioralNotes;
            if (rescueLocation) updatedData.rescueLocation = rescueLocation;
            if (rescueAddress) updatedData.rescueAddress = rescueAddress;
            if (isSterilized) updatedData.isSterilized = isSterilized;

            await prisma.dog.update({
                where: { id: dogId },
                data: updatedData,
            });

            if (parsedLocation !== null) {
                await prisma.$executeRaw`
                    UPDATE dogs
                    SET rescueLocation = ST_SetSRID(ST_MakePoint(${parsedLocation.longitude}, ${parsedLocation.latitude}), 4326)
                    WHERE id = ${dogId};
                `
            }

            const updatedDog = await prisma.dog.findUnique({
                where: {
                    id: dogId,
                    status: STATUS_ACTIVE
                },
            })

            res.status(200).json({ success: true, message: "Successfully updated", data: updatedDog ? [updatedDog] : [] });
            return;
        }
        const rescueLocationToParse = parsedLocation as { latitude: number; longitude: number };

        const newDog = await prisma.$queryRaw<Array<{ id: number }>>`
            INSERT INTO "dogs" (
                "temp_id",
                "rfid_tag",
                "shelter_id",
                "profile_status",
                "lifecycle_state",
                "lifecycle_phase",
                "estimated_age",
                "sex",
                "breed",
                "color",
                "distinguishing_marks",
                "intake_condition",
                "behavioral_notes",
                "rescue_location",
                "rescue_address",
                "intake_by",
                "is_sterilized",
                "status",
                "created_at",
                "updated_at" -- Explicitly added
            ) VALUES (
                ${tempId},
                ${rfidTag},
                ${shelterId},
                ${profileStatus}::"ProfileStatus",
                ${lifecycleState}::"LifecycleState",
                ${lifecyclePhase || 'INITIAL'}::"LifecyclePhase",
                ${estimatedAge},
                ${sex}::"AnimalSex",
                ${breed},
                ${color},
                ${distinguishingMarks},
                ${intakeCondition}::"IntakeCondition",
                ${behavioralNotes},
                ST_SetSRID(ST_MakePoint(${rescueLocationToParse.longitude}, ${rescueLocationToParse.latitude}), 4326),
                ${rescueAddress},
                ${userId},
                ${isSterilized || false},
                1,
                NOW(), -- For created_at
                NOW()  -- For updated_at
            ) RETURNING id
        `;
        const createdDogId = newDog[0].id;
        const createdDog = createdDogId ? await prisma.dog.findUnique({
            where: {
                id: createdDogId,
                status: STATUS_ACTIVE
            },
        }) : null;

        res.status(201).json({ success: true, message: "Successfully created", data: createdDog ? [createdDog] : [] });
    } catch (error) {
        res.status(500).json({ success: false, message: "Something went wrong", data: error });
    }

}


export const uploadPhotos = async (req: Request, res: Response): Promise<void> => {
    const payload = (req.body && typeof req.body === "object") ? req.body : {};
    const { dogId, photoType, isPrimary } = payload as Record<string, unknown>;
    const parsedDogId = parseOptionalInt(dogId);

    if (parsedDogId === null) {
        res.status(422).json({
            success: false,
            message: "Validation failed",
            data: { dogId: ["The dogId must be an integer."] },
        });
        return;
    }

    const normalizedPhotoType = String(photoType || "").trim().toUpperCase();
    const parsedPhotoType = Object.values(PhotoType).includes(normalizedPhotoType as PhotoType)
        ? (normalizedPhotoType as PhotoType)
        : null;

    if (parsedPhotoType === null) {
        res.status(422).json({
            success: false,
            message: "Validation failed",
            data: { photoType: ["The photoType must be one of FACE, SIDE, MARKS, OTHER."] },
        });
        return;
    }

    const filesBag = (req.files && typeof req.files === "object")
        ? (req.files as Record<string, unknown>)
        : undefined;
    const rawBase64 = [
        (payload as any).photoBase64,
        (payload as any).photosBase64,
        (payload as any).imageBase64,
    ].flat().filter((value) => typeof value === "string" && value.trim() !== "") as string[];

    if ((!filesBag || Object.keys(filesBag).length === 0) && rawBase64.length === 0) {
        res.status(422).json({
            success: false,
            message: "Validation failed",
            data: {
                photos: ["No files were uploaded. Send request as multipart/form-data."],
                contentType: [String(req.headers["content-type"] || "missing")],
            },
        });
        return;
    }

    const incomingFile = filesBag
        ? (
            filesBag.photos
            ?? filesBag.photo
            ?? filesBag.file
            ?? filesBag.image
            ?? Object.values(filesBag)[0]
        )
        : undefined;

    if (!incomingFile && rawBase64.length === 0) {
        res.status(422).json({
            success: false,
            message: "Validation failed",
            data: {
                photos: ["Unable to detect uploaded file. Use form-data key `photos`."],
                fileKeys: filesBag ? Object.keys(filesBag) : [],
            },
        });
        return;
    }

    const files = incomingFile
        ? (Array.isArray(incomingFile) ? incomingFile : [incomingFile]) as UploadedFile[]
        : [];
    const imageMimeTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

    const invalidTypeFile = files.find((file) => !imageMimeTypes.includes(file.mimetype));
    if (invalidTypeFile) {
        res.status(422).json({
            success: false,
            message: "Validation failed",
            data: { photos: [`Unsupported file type: ${invalidTypeFile.mimetype}`] },
        });
        return;
    }

    const dog = await prisma.dog.findFirst({
        where: {
            id: parsedDogId,
            status: { not: STATUS_DELETED },
        },
    });

    if (!dog) {
        res.status(404).json({
            success: false,
            message: "Dog not found",
            data: [],
        });
        return;
    }

    const parsedIsPrimary = String(isPrimary ?? "false").toLowerCase() === "true";

    const uploadDir = path.join(process.cwd(), "public", "uploads", "dogs");
    fs.mkdirSync(uploadDir, { recursive: true });

    const uploadedEntries: Array<{
        photoUrl: string;
        photoType: PhotoType;
        isPrimary: boolean;
        capturedAt: Date;
    }> = [];

    try {
        for (const file of files) {
            const extension = path.extname(file.name || "").toLowerCase() || ".jpg";
            const generatedName = `${uuidv4()}${extension}`;
            const absolutePath = path.join(uploadDir, generatedName);

            await file.mv(absolutePath);

            const publicPath = `/uploads/dogs/${generatedName}`;
            const fullUrl = `${req.protocol}://${req.get("host")}${publicPath}`;

            uploadedEntries.push({
                photoUrl: fullUrl,
                photoType: parsedPhotoType,
                isPrimary: parsedIsPrimary,
                capturedAt: new Date(),
            });
        }

        for (const encodedImage of rawBase64) {
            const matched = encodedImage.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
            const mimeType = matched?.[1] || "image/jpeg";
            const base64Data = matched?.[2] || encodedImage;

            if (!imageMimeTypes.includes(mimeType)) {
                res.status(422).json({
                    success: false,
                    message: "Validation failed",
                    data: { photos: [`Unsupported base64 image type: ${mimeType}`] },
                });
                return;
            }

            const extension = mimeType === "image/png"
                ? ".png"
                : mimeType === "image/webp"
                    ? ".webp"
                    : ".jpg";
            const generatedName = `${uuidv4()}${extension}`;
            const absolutePath = path.join(uploadDir, generatedName);
            const buffer = Buffer.from(base64Data, "base64");
            fs.writeFileSync(absolutePath, buffer);

            const publicPath = `/uploads/dogs/${generatedName}`;
            const fullUrl = `${req.protocol}://${req.get("host")}${publicPath}`;

            uploadedEntries.push({
                photoUrl: fullUrl,
                photoType: parsedPhotoType,
                isPrimary: parsedIsPrimary,
                capturedAt: new Date(),
            });
        }

        await prisma.$transaction(async (tx) => {
            if (parsedIsPrimary) {
                await tx.dogPhoto.updateMany({
                    where: { dogId: parsedDogId },
                    data: { isPrimary: false },
                });
            }

            await tx.dogPhoto.createMany({
                data: uploadedEntries.map((entry) => ({
                    dogId: parsedDogId,
                    photoUrl: entry.photoUrl,
                    photoType: entry.photoType,
                    isPrimary: entry.isPrimary,
                    capturedAt: entry.capturedAt,
                })),
            });
        });

        const latestPhotos = await prisma.dogPhoto.findMany({
            where: { dogId: parsedDogId },
            orderBy: { capturedAt: "desc" },
            take: files.length,
        });

        res.status(201).json({
            success: true,
            message: "Photos uploaded successfully",
            data: latestPhotos,
        });
    } catch (error) {
        console.error("Error uploading photos:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            data: [],
        });
    }
}

export const scanByRfid = async (req: Request, res: Response): Promise<void> => {
    const rfidTag = req.params.rfid;

    const validationRules: any = {
        rfid: "required|string",
    };

    const { passed, errors } = validate(req.params, validationRules);

    if (!passed) {
        res.status(422).json({ success: false, message: "Validation failed", data: errors });
        return;
    }

    try {
        const dogData = await prisma.dog.findFirst({
            where: {
                rfidTag: rfidTag,
                status: { not: STATUS_DELETED },
            },
        });

        if (!dogData) {
            res.status(404).json({ success: false, message: "Dog not found" });
            return;
        }

        const dogId = dogData.id;
        const dogPhotos = await prisma.dogPhoto.findMany({
            where: { dogId: dogId },
            orderBy: { capturedAt: "desc" },
        });

        res.status(200).json({
            success: true,
            message: "Dog found",
            data: [{ ...dogData, photos: dogPhotos }],
        });
    } catch (error) {
        console.error("Database Error:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
}

export const linkRfid = async (req: Request, res: Response): Promise<void> => {
    const { dogId, rfidTag } = req.body;

    const validationRules: any = {
        dogId: "required|integer",
        rfidTag: "required|string",
    };

    const { passed, errors } = validate(req.body, validationRules);

    if (!passed) {
        res.status(422).json({ success: false, message: "Validation failed", data: errors });
        return;
    }

    try {
        const parsedDogId = Number(dogId);

        // 1. Fetch current dog data
        const dogData = await prisma.dog.findFirst({
            where: {
                id: parsedDogId,
                status: { not: STATUS_DELETED },
            },
        });

        if (!dogData) {
            res.status(404).json({ success: false, message: "Dog not found" });
            return;
        }

        // 2. Prevent duplicate RFID linking across the system
        const existingRfid = await prisma.dog.findFirst({
            where: {
                rfidTag: rfidTag,
                id: { not: parsedDogId },
                status: { not: STATUS_DELETED }
            }
        });

        if (existingRfid) {
            res.status(409).json({
                success: false,
                message: `RFID tag ${rfidTag} is already assigned to another active dog.`
            });
            return;
        }

        // 3. Determine the Next State based on your state diagram
        // Transition: AWAITING_IDENTIFICATION -> UNDER_OBSERVATION (if healthy)
        // Transition: AWAITING_IDENTIFICATION -> EMERGENCY_MEDICAL (if critical/emergency)

        let nextState = dogData.lifecycleState;

        if (dogData.lifecycleState === 'AWAITING_IDENTIFICATION') {
            if (dogData.intakeCondition === 'HEALTHY') {
                nextState = 'UNDER_OBSERVATION';
            } else if (dogData.intakeCondition === 'RABIES_SUSPECTED' || dogData.intakeCondition === 'INJURED' || dogData.intakeCondition === 'MALNOURISHED') {
                nextState = 'EMERGENCY_MEDICAL';
            }
        }

        // 4. Update Database
        await prisma.dog.update({
            where: { id: parsedDogId },
            data: {
                rfidTag: rfidTag,
                lifecycleState: nextState,
                updatedAt: new Date()
            },
        });

        res.status(200).json({
            success: true,
            message: `RFID linked. State moved to ${nextState}.`,
            data: { currentState: nextState }
        });

    } catch (error) {
        console.error("Database Error:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
}

export const list = async (req: Request, res: Response): Promise<void> => {
    const id = parseOptionalInt(req.query.id);
    console.log(id);

    if (req.query.id !== undefined && id === null) {
        res.status(422).json({
            success: false,
            message: "Validation failed",
            data: { id: ["The id must be an integer."] },
        });
        return;
    }

    try {
        if (id !== null) {
            const dog = await prisma.dog.findFirst({
                where: {
                    id,
                    status: { not: STATUS_DELETED },
                },
            });

            if (!dog) {
                res.status(404).json({
                    success: false,
                    message: "Dog not found",
                    data: [],
                });
                return;
            }

            res.status(200).json({
                success: true,
                message: "Dog found",
                data: [dog],
            });
        } else {
            const dogs = await prisma.dog.findMany({
                where: {
                    status: { not: STATUS_DELETED },
                },
            });

            res.status(200).json({
                success: true,
                message: "Dogs found",
                data: dogs,
            });
        }

    } catch (error) {
        console.error("Error listing shelters:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            data: [],
        });
    }
}

export const verify = async (req: Request, res: Response): Promise<void> => { }

export const identify = async (req: Request, res: Response): Promise<void> => { }

export const batchIntake = async (req: Request, res: Response): Promise<void> => {
    const { userId, role } = (req as any).tokenData;
    const payload = (req.body && typeof req.body === "object")
        ? req.body
        : {};
    const candidates = (payload as any).dogs ?? (payload as any).items ?? (payload as any).data;
    const records = Array.isArray(candidates) ? candidates : [];
    const parsedChunkSize = parseOptionalInt((payload as any).chunkSize);
    const chunkSize = Math.min(Math.max(parsedChunkSize ?? 25, 1), 100);
    const activeStatus = Number.isFinite(STATUS_ACTIVE) && STATUS_ACTIVE > 0 ? STATUS_ACTIVE : 1;

    if (role !== "FIELD_TECH") {
        res.status(403).json({
            success: false,
            message: "Forbidden",
            data: [],
        });
        return;
    }

    if (!Array.isArray(candidates) || records.length === 0) {
        res.status(422).json({
            success: false,
            message: "Validation failed",
            data: {
                items: ["Provide a non-empty array in `dogs` (or `items` / `data`)."],
            },
        });
        return;
    }

    const successItems: Array<{ index: number; id: number; tempId: string }> = [];
    const failedItems: Array<{ index: number; tempId: string | null; reason: string; details?: any }> = [];

    const processOne = async (item: any, index: number): Promise<void> => {
        const tempId = item?.tempId ? String(item.tempId) : null;
        const validationRules: Record<string, string> = {
            tempId: "required|string",
            shelterId: "required|integer",
            profileStatus: "required|string",
            lifecycleState: "required|string",
            sex: "required|string",
            intakeCondition: "required|string",
        };

        const { passed, errors } = validate(item || {}, validationRules);
        if (!passed) {
            failedItems.push({
                index,
                tempId,
                reason: "Validation failed",
                details: errors,
            });
            return;
        }

        const parsedLocation = parseCoordinates(item.rescueLocation, null, null);
        if (parsedLocation === null) {
            failedItems.push({
                index,
                tempId,
                reason: "Invalid rescueLocation",
                details: { rescueLocation: ["Valid latitude/longitude are required."] },
            });
            return;
        }

        try {
            const lifecyclePhase = item.lifecyclePhase || "INTAKE_IDENTIFICATION";
            const parsedSterilized = typeof item.isSterilized === "boolean"
                ? item.isSterilized
                : String(item.isSterilized || "false").toLowerCase() === "true";

            const inserted = await prisma.$queryRaw<Array<{ id: number }>>`
                INSERT INTO "dogs" (
                    "temp_id",
                    "rfid_tag",
                    "shelter_id",
                    "profile_status",
                    "lifecycle_state",
                    "lifecycle_phase",
                    "estimated_age",
                    "sex",
                    "breed",
                    "color",
                    "distinguishing_marks",
                    "intake_condition",
                    "behavioral_notes",
                    "rescue_location",
                    "rescue_address",
                    "intake_by",
                    "is_sterilized",
                    "status",
                    "created_at",
                    "updated_at"
                ) VALUES (
                    ${item.tempId},
                    ${item.rfidTag ?? null},
                    ${Number(item.shelterId)},
                    ${item.profileStatus}::"ProfileStatus",
                    ${item.lifecycleState}::"LifecycleState",
                    ${lifecyclePhase}::"LifecyclePhase",
                    ${item.estimatedAge ?? null},
                    ${item.sex}::"AnimalSex",
                    ${item.breed ?? null},
                    ${item.color ?? null},
                    ${item.distinguishingMarks ?? null},
                    ${item.intakeCondition}::"IntakeCondition",
                    ${item.behavioralNotes ?? null},
                    ST_SetSRID(ST_MakePoint(${parsedLocation.longitude}, ${parsedLocation.latitude}), 4326),
                    ${item.rescueAddress ?? null},
                    ${userId},
                    ${parsedSterilized},
                    ${activeStatus},
                    NOW(),
                    NOW()
                ) RETURNING id
            `;

            const createdDogId = inserted[0]?.id;
            if (!createdDogId) {
                failedItems.push({
                    index,
                    tempId,
                    reason: "Failed to create dog record",
                });
                return;
            }

            successItems.push({
                index,
                id: createdDogId,
                tempId: String(item.tempId),
            });
        } catch (error: any) {
            if (error?.code === "P2002") {
                failedItems.push({
                    index,
                    tempId,
                    reason: "Duplicate tempId or rfidTag",
                });
                return;
            }

            failedItems.push({
                index,
                tempId,
                reason: "Database error",
                details: error?.message || String(error),
            });
        }
    };

    try {
        for (let start = 0; start < records.length; start += chunkSize) {
            const chunk = records.slice(start, start + chunkSize);
            await Promise.all(chunk.map((item, offset) => processOne(item, start + offset)));
            await new Promise<void>((resolve) => setImmediate(resolve));
        }

        const total = records.length;
        const successCount = successItems.length;
        const failedCount = failedItems.length;

        res.status(failedCount > 0 ? 207 : 201).json({
            success: failedCount === 0,
            message: failedCount > 0
                ? "Batch intake completed with partial failures"
                : "Batch intake completed successfully",
            data: {
                summary: {
                    total,
                    processed: successCount + failedCount,
                    successCount,
                    failedCount,
                    chunkSize,
                },
                successItems,
                failedItems,
            },
        });
    } catch (error) {
        console.error("Error in batch intake:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            data: [],
        });
    }
}

export const batchRescueIntake = async (req: Request, res: Response): Promise<void> => {
    const { userId, role, shelterId: tokenShelterId } = (req as any).tokenData || {};
    const payload = (req.body && typeof req.body === "object") ? req.body : {};
    console.log("payload", payload);
    const rawCandidates = (payload as any).dogs ?? (payload as any).items ?? (payload as any).data;

    let records: any[] = [];
    if (Array.isArray(rawCandidates)) {
        records = rawCandidates;
    } else if (typeof rawCandidates === "string") {
        try {
            const parsed = JSON.parse(rawCandidates);
            records = Array.isArray(parsed) ? parsed : [];
        } catch {
            records = [];
        }
    }

    if (role !== "FIELD_TECH") {
        res.status(403).json({ success: false, message: "Forbidden", data: [] });
        return;
    }

    if (!records.length) {
        res.status(422).json({
            success: false,
            message: "Validation failed",
            data: { dogs: ["Provide a non-empty dogs/items/data array."] },
        });
        return;
    }

    const filesBag = (req.files && typeof req.files === "object")
        ? (req.files as Record<string, unknown>)
        : {};
    const fileKeys = Object.keys(filesBag);
    const imageMimeTypes = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
    const uploadDir = path.join(process.cwd(), "public", "uploads", "dogs");
    fs.mkdirSync(uploadDir, { recursive: true });

    const explicitShelterId = parseOptionalInt((payload as any).shelterId);
    // let fallbackShelterId = explicitShelterId ?? parseOptionalInt(tokenShelterId);
    // if (fallbackShelterId === null) {
    //     const shelter = await prisma.shelter.findFirst({
    //         where: { status: { not: STATUS_DELETED } },
    //         orderBy: { id: "asc" },
    //         select: { id: true },
    //     });
    //     fallbackShelterId = shelter?.id ?? null;
    // }

    // if (fallbackShelterId === null) {
    //     res.status(422).json({
    //         success: false,
    //         message: "Validation failed",
    //         data: { shelterId: ["No active shelter found. Provide shelterId in request body."] },
    //     });
    //     return;
    // }

    const findIndexedFile = (index: number): UploadedFile | null => {
        const candidates = [
            `photo_${index}`,
            `image_${index}`,
            `dogPhoto_${index}`,
            `dogImage_${index}`,
            `photo[${index}]`,
            `image[${index}]`,
            `dogPhoto[${index}]`,
            `dogImage[${index}]`,
        ];

        for (const key of candidates) {
            const val = filesBag[key];
            if (!val) continue;
            if (Array.isArray(val)) return (val[0] as UploadedFile) || null;
            return val as UploadedFile;
        }

        const photosAny = filesBag.photos;
        if (Array.isArray(photosAny) && photosAny[index]) return photosAny[index] as UploadedFile;
        if (Array.isArray(filesBag.photo) && (filesBag.photo as unknown[])[index]) return (filesBag.photo as unknown[])[index] as UploadedFile;

        const matchedDynamicKey = fileKeys.find((k) => {
            const m = k.match(/(?:photo|image|dogphoto|dogimage)[_\[]?(\d+)\]?$/i);
            return !!m && Number(m[1]) === index;
        });
        if (matchedDynamicKey) {
            const val = filesBag[matchedDynamicKey];
            if (Array.isArray(val)) return (val[0] as UploadedFile) || null;
            return val as UploadedFile;
        }

        return null;
    };

    const savePhoto = async (index: number, item: any): Promise<string | null> => {
        const itemBase64 = [item.photoBase64, item.imageBase64, item.photosBase64]
            .flat()
            .find((v) => typeof v === "string" && String(v).trim() !== "") as string | undefined;
        const indexedFile = findIndexedFile(index);

        if (!itemBase64 && !indexedFile) return null;

        if (indexedFile) {
            if (!imageMimeTypes.has(indexedFile.mimetype)) {
                throw new Error(`Unsupported file type: ${indexedFile.mimetype}`);
            }
            const extension = path.extname(indexedFile.name || "").toLowerCase() || ".jpg";
            const generatedName = `${uuidv4()}${extension}`;
            const absolutePath = path.join(uploadDir, generatedName);
            await indexedFile.mv(absolutePath);
            return `${req.protocol}://${req.get("host")}/uploads/dogs/${generatedName}`;
        }

        const encoded = String(itemBase64);
        const matched = encoded.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
        const mimeType = matched?.[1] || "image/jpeg";
        const base64Data = matched?.[2] || encoded;

        if (!imageMimeTypes.has(mimeType)) {
            throw new Error(`Unsupported base64 image type: ${mimeType}`);
        }

        const extension = mimeType === "image/png"
            ? ".png"
            : mimeType === "image/webp"
                ? ".webp"
                : ".jpg";
        const generatedName = `${uuidv4()}${extension}`;
        const absolutePath = path.join(uploadDir, generatedName);
        fs.writeFileSync(absolutePath, Buffer.from(base64Data, "base64"));
        return `${req.protocol}://${req.get("host")}/uploads/dogs/${generatedName}`;
    };

    const successItems: Array<{ index: number; id: number; mode: "existing" | "new"; tempId?: string; qrCode?: string; photoUrl: string }> = [];
    const failedItems: Array<{ index: number; tempId?: string | null; qrCode?: string | null; reason: string }> = [];

    for (let index = 0; index < records.length; index++) {
        const item = records[index] || {};
        const qrCode = item?.qrCode ? String(item.qrCode).trim() : "";
        const tempId = item?.tempId ? String(item.tempId).trim() : "";
        const parsedLocation = parseCoordinates(item.rescueLocation, null, null);

        if (parsedLocation === null) {
            failedItems.push({ index, tempId: tempId || null, qrCode: qrCode || null, reason: "Invalid rescueLocation" });
            continue;
        }

        // Strict identity rule: exactly one of tempId or qrCode is required.
        if ((!tempId && !qrCode) || (tempId && qrCode)) {
            failedItems.push({
                index,
                tempId: tempId || null,
                qrCode: qrCode || null,
                reason: "Provide exactly one identity: tempId (new dog) OR qrCode (existing dog)",
            });
            continue;
        }

        try {
            const photoUrl = await savePhoto(index, item);
            if (!photoUrl) {
                failedItems.push({ index, tempId: tempId || null, qrCode: qrCode || null, reason: "Photo is required (single photo per dog)" });
                continue;
            }

            if (qrCode) {
                const existingDog = await prisma.dog.findFirst({
                    where: { qrCode, status: { not: STATUS_DELETED } },
                    select: { id: true },
                });

                if (!existingDog) {
                    failedItems.push({ index, qrCode, reason: "Dog not found for qrCode" });
                    continue;
                }

                await prisma.$executeRaw`
                    UPDATE dogs
                    SET rescue_location = ST_SetSRID(ST_MakePoint(${parsedLocation.longitude}, ${parsedLocation.latitude}), 4326),
                        rescue_address = ${item.rescueAddress ?? null},
                        updated_at = NOW(),
                        lifecycle_state = ${"IN_TRANSIT"}::"LifecycleState",
                        lifecycle_phase = ${"INTAKE_IDENTIFICATION"}::"LifecyclePhase"
                    WHERE id = ${existingDog.id};
                `;

                await prisma.dogPhoto.create({
                    data: {
                        dogId: existingDog.id,
                        photoUrl,
                        photoType: PhotoType.OTHER,
                        isPrimary: true,
                        capturedAt: new Date(),
                    },
                });

                successItems.push({ index, id: existingDog.id, mode: "existing", qrCode, photoUrl });
                continue;
            }

            const duplicateTempId = await prisma.dog.findFirst({
                where: { tempId, status: { not: STATUS_DELETED } },
                select: { id: true },
            });
            if (duplicateTempId) {
                failedItems.push({
                    index,
                    tempId,
                    reason: "tempId already exists. For existing dog, send qrCode instead of tempId",
                });
                continue;
            }

            const inserted = await prisma.$queryRaw<Array<{ id: number }>>`
                INSERT INTO "dogs" (
                    "temp_id","rfid_tag","shelter_id","profile_status","lifecycle_state","lifecycle_phase",
                    "estimated_age","sex","breed","color","distinguishing_marks","intake_condition",
                    "behavioral_notes","rescue_location","rescue_address","intake_by","is_sterilized","status",
                    "created_at","updated_at"
                ) VALUES (
                    ${tempId},${null},${null},${"TEMPORARY"}::"ProfileStatus",${"IN_TRANSIT"}::"LifecycleState",
                    ${"INTAKE_IDENTIFICATION"}::"LifecyclePhase",${null},${"UNKNOWN"}::"AnimalSex",${null},${null},${null},
                    ${"HEALTHY"}::"IntakeCondition",${null},
                    ST_SetSRID(ST_MakePoint(${parsedLocation.longitude}, ${parsedLocation.latitude}), 4326),
                    ${item.rescueAddress ?? null},${userId},${false},${STATUS_ACTIVE || 1},NOW(),NOW()
                ) RETURNING id
            `;

            const createdDogId = inserted[0]?.id;
            if (!createdDogId) {
                failedItems.push({ index, tempId, reason: "Failed to create dog record" });
                continue;
            }

            await prisma.dogPhoto.create({
                data: {
                    dogId: createdDogId,
                    photoUrl,
                    photoType: PhotoType.OTHER,
                    isPrimary: true,
                    capturedAt: new Date(),
                },
            });

            successItems.push({ index, id: createdDogId, mode: "new", tempId, photoUrl });
        } catch (error: any) {
            failedItems.push({
                index,
                tempId: tempId || null,
                qrCode: qrCode || null,
                reason: error?.message || "Database error",
            });
        }
    }

    res.status(failedItems.length ? 207 : 201).json({
        success: failedItems.length === 0,
        message: failedItems.length ? "Batch rescue intake completed with partial failures" : "Batch rescue intake completed successfully",
        data: {
            summary: {
                total: records.length,
                processed: successItems.length + failedItems.length,
                successCount: successItems.length,
                failedCount: failedItems.length,
            },
            successItems,
            failedItems,
        },
    });
}
export const transferCapturedDogs = async (req: Request, res: Response): Promise<void> => {
    const { userId, role, shelterId: tokenShelterId } = (req as any).tokenData || {};
    const payload = (req.body && typeof req.body === "object") ? req.body : {};
    const rawCandidates = (payload as any).dogs ?? (payload as any).items ?? (payload as any).data;

    let records: any[] = [];
    if (Array.isArray(rawCandidates)) {
        records = rawCandidates;
    } else if (typeof rawCandidates === "string") {
        try {
            const parsed = JSON.parse(rawCandidates);
            records = Array.isArray(parsed) ? parsed : [];
        } catch {
            records = [];
        }
    }

    if (role !== "FIELD_TECH") {
        res.status(403).json({ success: false, message: "Forbidden", data: [] });
        return;
    }

    if (!records.length) {
        res.status(422).json({
            success: false,
            message: "Validation failed",
            data: { dogs: ["Provide a non-empty dogs/items/data array."] },
        });
        return;
    }

    const filesBag = (req.files && typeof req.files === "object")
        ? (req.files as Record<string, unknown>)
        : {};
    const fileKeys = Object.keys(filesBag);
    const imageMimeTypes = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
    const uploadDir = path.join(process.cwd(), "public", "uploads", "dogs");
    fs.mkdirSync(uploadDir, { recursive: true });

    const explicitShelterId = parseOptionalInt((payload as any).shelterId);
    // let fallbackShelterId = explicitShelterId ?? parseOptionalInt(tokenShelterId);
    // if (fallbackShelterId === null) {
    //     const shelter = await prisma.shelter.findFirst({
    //         where: { status: { not: STATUS_DELETED } },
    //         orderBy: { id: "asc" },
    //         select: { id: true },
    //     });
    //     fallbackShelterId = shelter?.id ?? null;
    // }
    // if (fallbackShelterId === null) {
    //     res.status(422).json({
    //         success: false,
    //         message: "Validation failed",
    //         data: { shelterId: ["No active shelter found. Provide shelterId in request body."] },
    //     });
    //     return;
    // }

    const findIndexedFile = (index: number): UploadedFile | null => {
        const candidates = [
            `photo_${index}`,
            `image_${index}`,
            `dogPhoto_${index}`,
            `dogImage_${index}`,
            `photo[${index}]`,
            `image[${index}]`,
            `dogPhoto[${index}]`,
            `dogImage[${index}]`,
        ];
        for (const key of candidates) {
            const val = filesBag[key];
            if (!val) continue;
            if (Array.isArray(val)) return (val[0] as UploadedFile) || null;
            return val as UploadedFile;
        }
        const photosAny = filesBag.photos;
        if (Array.isArray(photosAny) && photosAny[index]) return photosAny[index] as UploadedFile;
        if (Array.isArray(filesBag.photo) && (filesBag.photo as unknown[])[index]) return (filesBag.photo as unknown[])[index] as UploadedFile;
        const matchedDynamicKey = fileKeys.find((k) => {
            const m = k.match(/(?:photo|image|dogphoto|dogimage)[_\[]?(\d+)\]?$/i);
            return !!m && Number(m[1]) === index;
        });
        if (matchedDynamicKey) {
            const val = filesBag[matchedDynamicKey];
            if (Array.isArray(val)) return (val[0] as UploadedFile) || null;
            return val as UploadedFile;
        }
        return null;
    };

    const storeDogPhoto = async (index: number, item: any): Promise<string | null> => {
        const itemBase64 = [item.photoBase64, item.imageBase64, item.photosBase64]
            .flat()
            .find((v) => typeof v === "string" && String(v).trim() !== "") as string | undefined;
        const indexedFile = findIndexedFile(index);

        if (!itemBase64 && !indexedFile) return null;

        if (indexedFile) {
            if (!imageMimeTypes.has(indexedFile.mimetype)) {
                throw new Error(`Unsupported file type: ${indexedFile.mimetype}`);
            }
            const extension = path.extname(indexedFile.name || "").toLowerCase() || ".jpg";
            const generatedName = `${uuidv4()}${extension}`;
            const absolutePath = path.join(uploadDir, generatedName);
            await indexedFile.mv(absolutePath);
            return `${req.protocol}://${req.get("host")}/uploads/dogs/${generatedName}`;
        }

        const encoded = String(itemBase64);
        const matched = encoded.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
        const mimeType = matched?.[1] || "image/jpeg";
        const base64Data = matched?.[2] || encoded;
        if (!imageMimeTypes.has(mimeType)) {
            throw new Error(`Unsupported base64 image type: ${mimeType}`);
        }
        const extension = mimeType === "image/png"
            ? ".png"
            : mimeType === "image/webp"
                ? ".webp"
                : ".jpg";
        const generatedName = `${uuidv4()}${extension}`;
        const absolutePath = path.join(uploadDir, generatedName);
        fs.writeFileSync(absolutePath, Buffer.from(base64Data, "base64"));
        return `${req.protocol}://${req.get("host")}/uploads/dogs/${generatedName}`;
    };

    const successItems: Array<{ index: number; id: number; mode: "known" | "unknown"; tempId?: string; qrCode?: string; photoUrl?: string }> = [];
    const failedItems: Array<{ index: number; tempId?: string | null; qrCode?: string | null; reason: string }> = [];

    for (let index = 0; index < records.length; index++) {
        const item = records[index] || {};
        const qrCode = item?.qrCode ? String(item.qrCode).trim() : "";
        const tempId = item?.tempId ? String(item.tempId) : `TMP-${Date.now()}-${index}-${uuidv4().slice(0, 8)}`;
        const parsedLocation = parseCoordinates(item.rescueLocation, null, null);

        if (parsedLocation === null) {
            failedItems.push({ index, tempId: item?.tempId || null, qrCode: qrCode || null, reason: "Invalid rescueLocation" });
            continue;
        }

        try {
            const storedPhotoUrl = await storeDogPhoto(index, item);
            if (!storedPhotoUrl) {
                failedItems.push({ index, tempId, qrCode: qrCode || null, reason: "Photo is required (single photo per dog)" });
                continue;
            }

            if (qrCode) {
                const knownDog = await prisma.dog.findFirst({
                    where: { qrCode, status: { not: STATUS_DELETED } },
                    select: { id: true },
                });
                if (!knownDog) {
                    failedItems.push({ index, tempId: null, qrCode, reason: "QR dog not found" });
                    continue;
                }

                await prisma.$executeRaw`
                    UPDATE dogs
                    SET rescue_location = ST_SetSRID(ST_MakePoint(${parsedLocation.longitude}, ${parsedLocation.latitude}), 4326),
                        rescue_address = ${item.rescueAddress ?? null},
                        updated_at = NOW()
                    WHERE id = ${knownDog.id};
                `;

                await prisma.dogPhoto.create({
                    data: {
                        dogId: knownDog.id,
                        photoUrl: storedPhotoUrl,
                        photoType: PhotoType.OTHER,
                        isPrimary: true,
                        capturedAt: new Date(),
                    },
                });

                successItems.push({ index, id: knownDog.id, mode: "known", qrCode, photoUrl: storedPhotoUrl });
                continue;
            }

            // const shelterId = parseOptionalInt(item.shelterId) ?? fallbackShelterId;
            const inserted = await prisma.$queryRaw<Array<{ id: number }>>`
                INSERT INTO "dogs" (
                    "temp_id","rfid_tag","shelter_id","profile_status","lifecycle_state","lifecycle_phase",
                    "estimated_age","sex","breed","color","distinguishing_marks","intake_condition",
                    "behavioral_notes","rescue_location","rescue_address","intake_by","is_sterilized","status",
                    "created_at","updated_at"
                ) VALUES (
                    ${tempId},${null},${null},${"TEMPORARY"}::"ProfileStatus",${"AWAITING_IDENTIFICATION"}::"LifecycleState",
                    ${"INTAKE_IDENTIFICATION"}::"LifecyclePhase",${null},${"UNKNOWN"}::"AnimalSex",${item.breed ?? null},
                    ${item.color ?? null},${null},${"HEALTHY"}::"IntakeCondition",${null},
                    ST_SetSRID(ST_MakePoint(${parsedLocation.longitude}, ${parsedLocation.latitude}), 4326),
                    ${item.rescueAddress ?? null},${userId},${false},${STATUS_ACTIVE || 1},NOW(),NOW()
                ) RETURNING id
            `;
            const createdDogId = inserted[0]?.id;
            if (!createdDogId) {
                failedItems.push({ index, tempId, reason: "Failed to create dog record" });
                continue;
            }

            await prisma.dogPhoto.create({
                data: {
                    dogId: createdDogId,
                    photoUrl: storedPhotoUrl,
                    photoType: PhotoType.OTHER,
                    isPrimary: true,
                    capturedAt: new Date(),
                },
            });

            successItems.push({ index, id: createdDogId, mode: "unknown", tempId, photoUrl: storedPhotoUrl });
        } catch (error: any) {
            failedItems.push({
                index,
                tempId,
                qrCode: qrCode || null,
                reason: error?.message || "Database error",
            });
        }
    }

    res.status(failedItems.length ? 207 : 201).json({
        success: failedItems.length === 0,
        message: failedItems.length ? "Transfer completed with partial failures" : "Transfer completed successfully",
        data: {
            summary: {
                total: records.length,
                successCount: successItems.length,
                failedCount: failedItems.length,
            },
            successItems,
            failedItems,
        },
    });
}

export const updateDogProcessingStatus = async (req: Request, res: Response): Promise<void> => {
    const { userId, role } = (req as any).tokenData || {};
    const payload = (req.body && typeof req.body === "object") ? req.body : {};
    const dogId = parseOptionalInt((payload as any).dogId);

    if (!ADMIN_INTAKE_ROLES.has(String(role || ""))) {
        res.status(403).json({ success: false, message: "Forbidden", data: [] });
        return;
    }

    if (dogId === null) {
        res.status(422).json({
            success: false,
            message: "Validation failed",
            data: { dogId: ["dogId is required and must be integer"] },
        });
        return;
    }

    try {
        const dog = await prisma.dog.findFirst({
            where: { id: dogId, status: { not: STATUS_DELETED } },
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

        const qrCodeRaw = (payload as any).qrCode;
        const qrCode = typeof qrCodeRaw === "string" ? qrCodeRaw.trim() : "";
        const hasSterilized = Object.prototype.hasOwnProperty.call(payload, "isSterilized");
        const isSterilized = hasSterilized
            ? String((payload as any).isSterilized).toLowerCase() === "true" || (payload as any).isSterilized === true
            : undefined;

        const vaccinationDone = Object.prototype.hasOwnProperty.call(payload, "vaccinationDone")
            ? (String((payload as any).vaccinationDone).toLowerCase() === "true" || (payload as any).vaccinationDone === true)
            : undefined;
        const vaccinationDate = (payload as any).vaccinationDate ? String((payload as any).vaccinationDate) : null;
        const vaccinationNotes = (payload as any).vaccinationNotes ? String((payload as any).vaccinationNotes) : null;
        const sterilizationDate = (payload as any).sterilizationDate ? String((payload as any).sterilizationDate) : null;
        const sterilizationNotes = (payload as any).sterilizationNotes ? String((payload as any).sterilizationNotes) : null;

        const markReadyForRelease = String((payload as any).markReadyForRelease || "false").toLowerCase() === "true";
        const lifecycleStateInput = (payload as any).lifecycleState ? String((payload as any).lifecycleState) : null;

        const updateData: any = {
            updatedAt: new Date(),
        };

        if (qrCode) {
            const existingWithQr = await prisma.dog.findFirst({
                where: { qrCode, id: { not: dogId }, status: { not: STATUS_DELETED } },
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
            updateData.qrCode = qrCode;
            updateData.qrAssignedAt = new Date();
        }

        if (hasSterilized && typeof isSterilized === "boolean") {
            updateData.isSterilized = isSterilized;
        }

        const medicalLines: string[] = [];
        if (typeof vaccinationDone === "boolean") {
            medicalLines.push(`Vaccination: ${vaccinationDone ? "DONE" : "PENDING"}${vaccinationDate ? ` (${vaccinationDate})` : ""}`);
        }
        if (vaccinationNotes) medicalLines.push(`Vaccination Notes: ${vaccinationNotes}`);
        if (sterilizationDate || sterilizationNotes) {
            medicalLines.push(`Sterilization: ${sterilizationDate ? `DONE (${sterilizationDate})` : "UPDATED"}`);
            if (sterilizationNotes) medicalLines.push(`Sterilization Notes: ${sterilizationNotes}`);
        }

        if (medicalLines.length > 0) {
            const prefix = `[Processing Update by User ${userId} at ${new Date().toISOString()}]`;
            const block = `${prefix}\n${medicalLines.join("\n")}`;
            updateData.behavioralNotes = dog.behavioralNotes
                ? `${dog.behavioralNotes}\n\n${block}`
                : block;
        }

        if (markReadyForRelease) {
            updateData.lifecycleState = "READY_FOR_RELEASE";
            updateData.lifecyclePhase = "FINAL_DISPOSITION";
        } else if (lifecycleStateInput) {
            updateData.lifecycleState = lifecycleStateInput;
        }

        const updated = await prisma.dog.update({
            where: { id: dogId },
            data: updateData,
        });

        res.status(200).json({
            success: true,
            message: "Dog processing status updated",
            data: [updated],
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: error?.message || "Failed to update dog processing status",
            data: [],
        });
    }
}

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
                latestPhoto: includePhotos
                    ? (d.photos?.[0]
                        ? { ...d.photos[0], photoUrl: withEnvPhotoBaseUrl(d.photos[0].photoUrl) }
                        : null)
                    : null,
            })),
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to fetch release list", data: [] });
    }
}

export const releaseDogs = async (req: Request, res: Response): Promise<void> => {
    const { role } = (req as any).tokenData || {};
    // if (role !== "FIELD_TECH") {
    //     res.status(403).json({ success: false, message: "Forbidden", data: [] });
    //     return;
    // }

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

export const getWorkflowCounts = async (req: Request, res: Response): Promise<void> => {
    try {
        // const shelterId = parseOptionalInt(req.query.shelterId);
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(startOfDay);
        endOfDay.setDate(endOfDay.getDate() + 1);

        const baseWhere: any = {
            status: { not: STATUS_DELETED },
            // ...(shelterId !== null ? { shelterId } : {}),
            updatedAt: {
                gte: startOfDay,
                lt: endOfDay,
            },
        };

        const [shelterTransfer, scheduledReleases, dogsReleased] = await Promise.all([
            prisma.dog.count({
                where: {
                    ...baseWhere,
                    lifecycleState: "AWAITING_IDENTIFICATION",
                },
            }),
            prisma.dog.count({
                where: {
                    ...baseWhere,
                    lifecycleState: "READY_FOR_RELEASE",
                },
            }),
            prisma.dog.count({
                where: {
                    ...baseWhere,
                    lifecycleState: "RELEASED",
                },
            }),
        ]);

        res.status(200).json({
            success: true,
            message: "Workflow counts fetched",
            data: {
                date: startOfDay.toISOString().slice(0, 10),
                shelterTransfer,
                scheduledReleases,
                dogsReleased,
            },
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: error?.message || "Failed to fetch workflow counts",
            data: {},
        });
    }
}






