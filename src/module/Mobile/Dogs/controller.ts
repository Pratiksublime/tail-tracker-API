import { Request, Response } from "express";
// import { redisClient } from "../../../lib/redis";

const STATUS_ACTIVE = Number(process.env.STATUS_ACTIVE);
const STATUS_DELETED = Number(process.env.STATUS_DELETED);

export const list = async (req: Request, res: Response): Promise<void> => { }
export const getById = async (req: Request, res: Response): Promise<void> => { }
export const getByRfid = async (req: Request, res: Response): Promise<void> => { }
export const getByTempId = async (req: Request, res: Response): Promise<void> => { }
export const uploadPhotos = async (req: Request, res: Response): Promise<void> => { }
export const deletePhoto = async (req: Request, res: Response): Promise<void> => { }



