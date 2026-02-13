
import { PhotoType } from "@prisma/client";
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





