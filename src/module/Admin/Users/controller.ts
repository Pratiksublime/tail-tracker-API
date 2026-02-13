import { UserRole } from "@prisma/client";
import { Request, Response } from "express";
import { prisma } from "../../../lib/prisma";
import { hashPassword } from "../../../utils/auth.util";
import { validate } from "../../../utils/validator";

const STATUS_ACTIVE = Number(process.env.STATUS_ACTIVE) || 1;
const STATUS_DELETED = Number(process.env.STATUS_DELETED) || 0;

const userInclude = {
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
    shelter: {
        select: {
            id: true,
            name: true,
            code: true,
            ward: true,
            contactPhone: true,
            isActive: true,
            status: true,
        },
    },
};

const sanitizeUser = (user: any) => {
    const userResponse = { ...user };
    delete userResponse.passwordHash;
    return userResponse;
};

const parseOptionalInt = (value: unknown): number | null => {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value === "string" && value.trim() === "") return null;

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null;
    return parsed;
};

const parseOptionalBoolean = (value: unknown): boolean | null => {
    if (value === undefined || value === null || value === "") return null;

    if (typeof value === "boolean") return value;
    if (typeof value === "number") {
        if (value === 1) return true;
        if (value === 0) return false;
        return null;
    }

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true" || normalized === "1") return true;
        if (normalized === "false" || normalized === "0") return false;
    }

    return null;
};

const isValidRole = (role: string): role is UserRole => {
    return Object.values(UserRole).includes(role as UserRole);
};

export const create = async (req: Request, res: Response): Promise<void> => {
    const {
        id,
        email,
        phone,
        password,
        name,
        role,
        organizationId,
        shelterId,
        isActive,
    } = req.body;

    const userId = parseOptionalInt(id);
    const isUpdate = userId !== null;
    const parsedIsActive = parseOptionalBoolean(isActive);

    if (id !== undefined && userId === null) {
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
            email: "email",
            phone: "numeric",
            password: "min:6|max:20",
            name: "min:2|max:100",
            role: "string",
            organizationId: "integer",
            shelterId: "integer",
            isActive: "boolean",
        }
        : {
            email: "required|email",
            phone: "numeric",
            password: "required|min:6|max:20",
            name: "required|min:2|max:100",
            role: "required|string",
            organizationId: "integer",
            shelterId: "integer",
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

    if (role !== undefined && !isValidRole(role)) {
        res.status(422).json({
            success: false,
            message: "Invalid role value",
            data: [],
        });
        return;
    }

    try {
        if (isUpdate && userId !== null) {
            const existingUser = await prisma.user.findFirst({
                where: {
                    id: userId,
                    status: { not: STATUS_DELETED },
                },
            });

            if (!existingUser) {
                res.status(404).json({
                    success: false,
                    message: "User not found",
                    data: [],
                });
                return;
            }

            const updateData: any = {};
            if (email !== undefined) updateData.email = email;
            if (phone !== undefined) updateData.phone = phone || null;
            if (name !== undefined) updateData.name = name;
            if (role !== undefined) updateData.role = role;
            if (organizationId !== undefined)
                updateData.organizationId = parseOptionalInt(organizationId);
            if (shelterId !== undefined)
                updateData.shelterId = parseOptionalInt(shelterId);
            if (isActive !== undefined && parsedIsActive !== null)
                updateData.isActive = parsedIsActive;

            if (password !== undefined && password !== null && password !== "") {
                updateData.passwordHash = await hashPassword(password);
            }

            const updatedUser = await prisma.user.update({
                where: { id: userId },
                data: updateData,
                include: userInclude,
            });

            res.status(200).json({
                success: true,
                message: "User updated successfully",
                data: [sanitizeUser(updatedUser)],
            });
            return;
        }

        const existingUser = await prisma.user.findFirst({
            where: { email, status: { not: STATUS_DELETED } },
        });

        if (existingUser) {
            res.status(409).json({
                success: false,
                message: "Email already exists",
                data: [],
            });
            return;
        }

        const hashedPassword = await hashPassword(password);

        const createdUser = await prisma.user.create({
            data: {
                email,
                phone: phone || null,
                passwordHash: hashedPassword,
                name,
                role,
                organizationId: parseOptionalInt(organizationId),
                shelterId: parseOptionalInt(shelterId),
                isActive: isActive !== undefined && parsedIsActive !== null
                    ? parsedIsActive
                    : true,
            },
            include: userInclude,
        });

        res.status(201).json({
            success: true,
            message: "User created successfully",
            data: [sanitizeUser(createdUser)],
        });
    } catch (error: any) {
        if (error?.code === "P2002") {
            res.status(409).json({
                success: false,
                message: "Email or phone already exists",
                data: [],
            });
            return;
        }

        console.error("Error saving user:", error);
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
            data: { id: ["The id must be a number."] },
        });
        return;
    }

    try {
        if (id !== null) {
            const user = await prisma.user.findFirst({
                where: {
                    id,
                    status: { not: STATUS_DELETED },
                },
                include: userInclude,
            });

            if (!user) {
                res.status(404).json({
                    success: false,
                    message: "User not found",
                    data: [],
                });
                return;
            }

            res.status(200).json({
                success: true,
                message: "User fetched successfully",
                data: [sanitizeUser(user)],
            });
            return;
        }

        const users = await prisma.user.findMany({
            where: {
                status: { not: STATUS_DELETED },
            },
            include: userInclude,
            orderBy: {
                id: "desc",
            },
        });

        res.status(200).json({
            success: true,
            message: "Users fetched successfully",
            data: users.map(sanitizeUser),
        });
    } catch (error) {
        console.error("Error listing users:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            data: [],
        });
    }
};

export const deleteUser = async (req: Request, res: Response): Promise<void> => {
    const userIdToDelete = parseOptionalInt(req.params.id);
    const loggedInAdminId = Number((req as any).tokenData?.id);

    console.log(req.params.id);

    if (userIdToDelete === null) {
        res.status(422).json({
            success: false,
            message: "Validation failed",
            data: { id: ["The id must be an integer."] },
        });
        return;
    }

    // 2. Prevent self-deletion
    if (userIdToDelete === loggedInAdminId) {
        res.status(400).json({
            success: false,
            message: "You cannot delete your own admin account."
        });
        return;
    }

    try {
        const user = await prisma.user.findFirst({
            where: {
                id: userIdToDelete,
                status: { not: STATUS_DELETED },
            },
        });

        if (!user) {
            res.status(404).json({
                success: false,
                message: "User not found",
                data: [],
            });
            return;
        }

        await prisma.user.update({
            where: { id: userIdToDelete },
            data: {
                status: STATUS_DELETED,
                isActive: false,
            },
        });

        res.status(200).json({
            success: true,
            message: "User deleted successfully",
            data: [],
        });
    } catch (error) {
        console.error("Error deleting user:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            data: [],
        });
    }
};
