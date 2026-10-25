import { Router, Request, Response } from "express";
import { prisma } from "../db/prisma";

const router = Router();

// Get all notifications for user
router.get("/", async (req: any, res: Response) => {
  try {
    const userType = (req.query.userType as "PATIENT" | "DOCTOR") || req.user?.userType;
    const userId = (req.query.userId as string) || req.user?.userId;

    if (!userType || !userId) {
      return res.status(400).json({ error: "User type and ID are required" });
    }

    const notifications = await prisma.notification.findMany({
      where: {
        userType,
        userId,
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ notifications });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get unread count
router.get("/count", async (req: any, res: Response) => {
  try {
    const userType = (req.query.userType as "PATIENT" | "DOCTOR") || req.user?.userType;
    const userId = (req.query.userId as string) || req.user?.userId;

    if (!userType || !userId) {
      return res.status(400).json({ error: "User type and ID are required" });
    }

    const count = await prisma.notification.count({
      where: {
        userType,
        userId,
        read: false,
      },
    });

    res.json({ count });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Mark notification as read
router.post("/:id/read", async (req: any, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.notification.update({
      where: { id },
      data: { read: true },
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Mark all notifications as read
router.post("/read-all", async (req: any, res: Response) => {
  try {
    const userType = (req.query.userType as "PATIENT" | "DOCTOR") || req.user?.userType;
    const userId = (req.query.userId as string) || req.user?.userId;

    if (!userType || !userId) {
      return res.status(400).json({ error: "User type and ID are required" });
    }

    await prisma.notification.updateMany({
      where: {
        userType,
        userId,
        read: false,
      },
      data: { read: true },
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;