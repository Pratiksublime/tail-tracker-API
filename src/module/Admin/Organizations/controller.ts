import { OrganizationType } from "@prisma/client";
import { Request, Response } from "express";
import { prisma } from "../../../lib/prisma";
import { parseOptionalBoolean, parseOptionalInt } from "../../../utils/parseHelper";
import { validate } from "../../../utils/validator";

const STATUS_ACTIVE = Number(process.env.STATUS_ACTIVE) || 1;
const STATUS_DELETED = Number(process.env.STATUS_DELETED) || 0;



const isValidOrganizationType = (type: string): type is OrganizationType => {
    return Object.values(OrganizationType).includes(type as OrganizationType);
};

export const create = async (req: Request, res: Response): Promise<void> => {
    const {
        id,
        name,
        type,
        contactEmail,
        contactPhone,
        address,
        logoUrl,
        isActive,
    } = req.body;

    const organizationId = parseOptionalInt(id);
    const isUpdate = organizationId !== null;
    const parsedIsActive = parseOptionalBoolean(isActive);

    if (id !== undefined && organizationId === null) {
        res.status(422).json({
            success: false,
            message: "Validation failed",
            data: { id: ["The id must be an integer."] },
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

    const validationRules: Record<string, string> = isUpdate
        ? {
            id: "required|integer",
            name: "min:2|max:255",
            type: "string",
            contactEmail: "email|max:255",
            contactPhone: "string|max:20",
            address: "string",
            logoUrl: "string|max:500",
            isActive: "boolean",
        }
        : {
            name: "required|min:2|max:255",
            type: "required|string",
            contactEmail: "required|email|max:255",
            contactPhone: "required|string|max:20",
            address: "required|string",
            logoUrl: "string|max:500",
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

    if (type !== undefined && !isValidOrganizationType(type)) {
        res.status(422).json({
            success: false,
            message: "Invalid organization type value",
            data: [],
        });
        return;
    }

    try {
        if (isUpdate && organizationId !== null) {
            const existingOrganization = await prisma.organization.findFirst({
                where: {
                    id: organizationId,
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

            const updateData: any = {};
            if (name !== undefined) updateData.name = name;
            if (type !== undefined) updateData.type = type;
            if (contactEmail !== undefined) updateData.contactEmail = contactEmail;
            if (contactPhone !== undefined) updateData.contactPhone = contactPhone;
            if (address !== undefined) updateData.address = address;
            if (logoUrl !== undefined) updateData.logoUrl = logoUrl || null;
            if (isActive !== undefined && parsedIsActive !== null)
                updateData.isActive = parsedIsActive;
            const updatedOrganization = await prisma.organization.update({
                where: { id: organizationId },
                data: updateData,
            });

            res.status(200).json({
                success: true,
                message: "Organization updated successfully",
                data: [updatedOrganization],
            });
            return;
        }

        const createdOrganization = await prisma.organization.create({
            data: {
                name,
                type,
                contactEmail,
                contactPhone,
                address,
                logoUrl: logoUrl || null,
                isActive: isActive !== undefined && parsedIsActive !== null
                    ? parsedIsActive
                    : true,
            },
        });

        res.status(201).json({
            success: true,
            message: "Organization created successfully",
            data: [createdOrganization],
        });
    } catch (error: any) {
        if (error?.code === "P2002") {
            res.status(409).json({
                success: false,
                message: "Organization with the same unique value already exists",
                data: [],
            });
            return;
        }

        console.error("Error saving organization:", error);
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
            const organization = await prisma.organization.findFirst({
                where: {
                    id,
                    status: { not: STATUS_DELETED },
                },
            });

            if (!organization) {
                res.status(404).json({
                    success: false,
                    message: "Organization not found",
                    data: [],
                });
                return;
            }

            res.status(200).json({
                success: true,
                message: "Organization fetched successfully",
                data: [organization],
            });
            return;
        }

        const organizations = await prisma.organization.findMany({
            where: {
                status: { not: STATUS_DELETED },
            },
            orderBy: {
                id: "desc",
            },
        });

        res.status(200).json({
            success: true,
            message: "Organizations fetched successfully",
            data: organizations,
        });
    } catch (error) {
        console.error("Error listing organizations:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            data: [],
        });
    }
};

export const deleteOrganization = async (req: Request, res: Response): Promise<void> => {
    const organizationIdToDelete = parseOptionalInt(req.params.id);

    if (organizationIdToDelete === null) {
        res.status(422).json({
            success: false,
            message: "Validation failed",
            data: { id: ["The id must be an integer."] },
        });
        return;
    }

    try {
        const organization = await prisma.organization.findFirst({
            where: {
                id: organizationIdToDelete,
                status: { not: STATUS_DELETED },
            },
        });

        if (!organization) {
            res.status(404).json({
                success: false,
                message: "Organization not found",
                data: [],
            });
            return;
        }

        await prisma.organization.update({
            where: { id: organizationIdToDelete },
            data: {
                status: STATUS_DELETED,
                isActive: false,
            },
        });

        res.status(200).json({
            success: true,
            message: "Organization deleted successfully",
            data: [],
        });
    } catch (error) {
        console.error("Error deleting organization:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            data: [],
        });
    }
};
