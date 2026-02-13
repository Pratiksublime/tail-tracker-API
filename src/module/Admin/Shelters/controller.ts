import { Request, Response } from "express";
import { prisma } from "../../../lib/prisma";
import { parseCoordinates, parseOptionalBoolean, parseOptionalInt } from "../../../utils/parseHelper";
import { validate } from "../../../utils/validator";

const STATUS_ACTIVE = Number(process.env.STATUS_ACTIVE) || 1;
const STATUS_DELETED = Number(process.env.STATUS_DELETED) || 0;

const shelterInclude = {
    organization: {
        select: {
            id: true,
            name: true,
            type: true,
            contactEmail: true,
            contactPhone: true,
            isActive: true,
            status: true,
        },
    },
};


export const create = async (req: Request, res: Response): Promise<void> => {
    const {
        id,
        organizationId,
        name,
        code,
        address,
        location,
        latitude,
        longitude,
        ward,
        totalCapacity,
        contactPhone,
        operatingHours,
        isActive,

    } = req.body;

    const shelterId = parseOptionalInt(id);
    const isUpdate = shelterId !== null;
    const parsedOrganizationId = parseOptionalInt(organizationId);
    const parsedTotalCapacity = parseOptionalInt(totalCapacity);
    const parsedIsActive = parseOptionalBoolean(isActive);
    const parsedLocation = parseCoordinates(location, latitude, longitude);

    if (id !== undefined && shelterId === null) {
        res.status(422).json({
            success: false,
            message: "Validation failed",
            data: { id: ["The id must be an integer."] },
        });
        return;
    }

    if (organizationId !== undefined && parsedOrganizationId === null) {
        res.status(422).json({
            success: false,
            message: "Validation failed",
            data: { organizationId: ["The organizationId must be an integer."] },
        });
        return;
    }

    if (totalCapacity !== undefined && parsedTotalCapacity === null) {
        res.status(422).json({
            success: false,
            message: "Validation failed",
            data: { totalCapacity: ["The totalCapacity must be an integer."] },
        });
        return;
    }

    if (isActive !== undefined && parsedIsActive === null) {
        res.status(422).json({
            success: false,
            message: "Validation failed",
            data: { isActive: ["The isActive must be a boolean."] },
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
        && (location !== undefined || latitude !== undefined || longitude !== undefined)
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
            organizationId: "integer",
            name: "min:2|max:255",
            code: "string|max:20",
            address: "string",
            ward: "string|max:100",
            totalCapacity: "integer|min:1",
            contactPhone: "string|max:20",
            operatingHours: "",
            isActive: "boolean",

        }
        : {
            organizationId: "required|integer",
            name: "required|min:2|max:255",
            code: "required|string|max:20",
            address: "required|string",
            ward: "required|string|max:100",
            totalCapacity: "required|integer|min:1",
            contactPhone: "required|string|max:20",
            operatingHours: "required",
            isActive: "boolean",

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
        if (parsedOrganizationId !== null) {
            const existingOrganization = await prisma.organization.findFirst({
                where: {
                    id: parsedOrganizationId,
                    status: { not: STATUS_DELETED },
                },
            });

            if (!existingOrganization) {
                res.status(404).json({
                    success: false,
                    message: "Organization not found",
                    data: [],
                });
                return;
            }
        }

        if (isUpdate && shelterId !== null) {
            const existingShelter = await prisma.shelter.findFirst({
                where: {
                    id: shelterId,
                    status: { not: STATUS_DELETED },
                },
            });

            if (!existingShelter) {
                res.status(404).json({
                    success: false,
                    message: "Shelter not found",
                    data: [],
                });
                return;
            }

            const updateData: any = {};
            if (parsedOrganizationId !== null) updateData.organizationId = parsedOrganizationId;
            if (name !== undefined) updateData.name = name;
            if (code !== undefined) updateData.code = code;
            if (address !== undefined) updateData.address = address;
            if (ward !== undefined) updateData.ward = ward;
            if (parsedTotalCapacity !== null) updateData.totalCapacity = parsedTotalCapacity;
            if (contactPhone !== undefined) updateData.contactPhone = contactPhone;
            if (operatingHours !== undefined) updateData.operatingHours = operatingHours;
            if (parsedIsActive !== null) updateData.isActive = parsedIsActive;

            await prisma.shelter.update({
                where: { id: shelterId },
                data: updateData,
            });

            if (parsedLocation !== null) {
                await prisma.$executeRaw`
                    UPDATE shelters
                    SET location = ST_SetSRID(ST_MakePoint(${parsedLocation.longitude}, ${parsedLocation.latitude}), 4326),
                        updated_at = NOW()
                    WHERE id = ${shelterId}
                `;
            }

            const updatedShelter = await prisma.shelter.findUnique({
                where: { id: shelterId },
                include: shelterInclude,
            });

            res.status(200).json({
                success: true,
                message: "Shelter updated successfully",
                data: updatedShelter ? [updatedShelter] : [],
            });
            return;
        }

        const locationToPersist = parsedLocation as { latitude: number; longitude: number };

        const createdShelterIds = await prisma.$queryRaw<Array<{ id: number }>>`
            INSERT INTO shelters (
                organization_id,
                name,
                code,
                address,
                location,
                ward,
                total_capacity,
                contact_phone,
                operating_hours,
                is_active,
                created_at,
                updated_at
            )
            VALUES (
                ${parsedOrganizationId},
                ${name},
                ${code},
                ${address},
                ST_SetSRID(ST_MakePoint(${locationToPersist.longitude}, ${locationToPersist.latitude}), 4326),
                ${ward},
                ${parsedTotalCapacity},
                ${contactPhone},
                ${JSON.stringify(operatingHours)}::jsonb,
                ${parsedIsActive ?? true},
                NOW(),
                NOW()
            )
            RETURNING id
        `;

        const createdShelterId = createdShelterIds[0]?.id;
        const createdShelter = createdShelterId
            ? await prisma.shelter.findUnique({
                where: { id: createdShelterId },
                include: shelterInclude,
            })
            : null;

        res.status(201).json({
            success: true,
            message: "Shelter created successfully",
            data: createdShelter ? [createdShelter] : [],
        });
    } catch (error: any) {
        if (error?.code === "P2002") {
            res.status(409).json({
                success: false,
                message: "Shelter code already exists",
                data: [],
            });
            return;
        }

        console.error("Error saving shelter:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            data: [],
        });
    }
};

export const list = async (req: Request, res: Response): Promise<void> => {
    const id = parseOptionalInt(req.query.id);

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
            const shelter = await prisma.shelter.findFirst({
                where: {
                    id,
                    status: { not: STATUS_DELETED },
                },
                include: shelterInclude,
            });

            if (!shelter) {
                res.status(404).json({
                    success: false,
                    message: "Shelter not found",
                    data: [],
                });
                return;
            }

            res.status(200).json({
                success: true,
                message: "Shelter fetched successfully",
                data: [shelter],
            });
            return;
        }

        const shelters = await prisma.shelter.findMany({
            where: {
                status: { not: STATUS_DELETED },
            },
            include: shelterInclude,
            orderBy: {
                id: "desc",
            },
        });

        res.status(200).json({
            success: true,
            message: "Shelters fetched successfully",
            data: shelters,
        });
    } catch (error) {
        console.error("Error listing shelters:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            data: [],
        });
    }
};

export const deleteShelter = async (req: Request, res: Response): Promise<void> => {
    const shelterIdToDelete = parseOptionalInt(req.params.id);

    if (shelterIdToDelete === null) {
        res.status(422).json({
            success: false,
            message: "Validation failed",
            data: { id: ["The id must be an integer."] },
        });
        return;
    }

    try {
        const shelter = await prisma.shelter.findFirst({
            where: {
                id: shelterIdToDelete,
                status: { not: STATUS_DELETED },
            },
        });

        if (!shelter) {
            res.status(404).json({
                success: false,
                message: "Shelter not found",
                data: [],
            });
            return;
        }

        await prisma.shelter.update({
            where: { id: shelterIdToDelete },
            data: {
                status: STATUS_DELETED,
                isActive: false,
            },
        });

        res.status(200).json({
            success: true,
            message: "Shelter deleted successfully",
            data: [],
        });
    } catch (error) {
        console.error("Error deleting shelter:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            data: [],
        });
    }
};
