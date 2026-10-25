import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../db/prisma";

const router = Router();

// Dedicated rate limiter for live status polling: 60 requests per minute per user
const liveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => (req as any).user?.userId || req.ip || "unknown",
  handler: (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.status(429).json({ error: "Too many live status requests. Please wait." });
  },
});

/**
 * GET /api/live/status
 * Lightweight, indexed-only status endpoint returning small counters and an accessVersion.
 * Cache-Control: no-store
 */
router.get("/status", liveLimiter, async (req: any, res: Response) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");

  const user = req.user;
  if (!user || !user.userId || !user.userType) {
    return res.status(401).json({ error: "Session expired or not provided" });
  }

  try {
    const now = new Date();

    // 1. Unread notifications count (indexed query)
    const unreadNotifications = await prisma.notification.count({
      where: {
        userType: user.userType,
        userId: user.userId,
        read: false,
      },
    });

    if (user.userType === "PATIENT") {
      // Patient's access requests
      const requests = await prisma.accessRequest.findMany({
        where: { patientId: user.userId },
        select: {
          id: true,
          status: true,
          requestedAt: true,
          approvedAt: true,
          expiresAt: true,
        },
        orderBy: { requestedAt: "desc" },
      });

      let pendingRequestsCount = 0;
      const counts: Record<string, number> = {
        PENDING: 0,
        APPROVED: 0,
        DENIED: 0,
        EXPIRED: 0,
        REVOKED: 0,
      };
      let maxTimestamp = 0;

      for (const r of requests) {
        let status = r.status;
        // Server-side expiry check
        if (status === "APPROVED" && r.expiresAt && new Date(r.expiresAt) <= now) {
          status = "EXPIRED";
          prisma.accessRequest
            .update({ where: { id: r.id }, data: { status: "EXPIRED" } })
            .catch(() => {});
        }

        if (status === "PENDING") {
          pendingRequestsCount++;
        }
        counts[status] = (counts[status] || 0) + 1;

        const reqTime = r.requestedAt ? new Date(r.requestedAt).getTime() : 0;
        const appTime = r.approvedAt ? new Date(r.approvedAt).getTime() : 0;
        const expTime = r.expiresAt ? new Date(r.expiresAt).getTime() : 0;
        const t = Math.max(reqTime, appTime, expTime);
        if (t > maxTimestamp) maxTimestamp = t;
      }

      const accessVersion = `v-${maxTimestamp}-P${counts.PENDING}-A${counts.APPROVED}-D${counts.DENIED}-E${counts.EXPIRED}-R${counts.REVOKED}`;

      return res.json({
        userType: "PATIENT",
        unreadNotifications,
        accessVersion,
        pendingRequestsCount,
      });
    } else {
      // Doctor's access requests
      const requests = await prisma.accessRequest.findMany({
        where: { doctorId: user.userId },
        select: {
          id: true,
          status: true,
          requestedAt: true,
          approvedAt: true,
          expiresAt: true,
          patient: {
            select: { medOrgId: true },
          },
        },
        orderBy: { requestedAt: "desc" },
      });

      const counts: Record<string, number> = {
        PENDING: 0,
        APPROVED: 0,
        DENIED: 0,
        EXPIRED: 0,
        REVOKED: 0,
      };
      let maxTimestamp = 0;
      const activeGrants: Array<{
        requestId: string;
        patientMedOrgId: string;
        status: string;
        expiresAt: string | null;
      }> = [];

      for (const r of requests) {
        let status = r.status;
        // Server-side expiry check
        if (status === "APPROVED" && r.expiresAt && new Date(r.expiresAt) <= now) {
          status = "EXPIRED";
          prisma.accessRequest
            .update({ where: { id: r.id }, data: { status: "EXPIRED" } })
            .catch(() => {});
        }

        counts[status] = (counts[status] || 0) + 1;

        const reqTime = r.requestedAt ? new Date(r.requestedAt).getTime() : 0;
        const appTime = r.approvedAt ? new Date(r.approvedAt).getTime() : 0;
        const expTime = r.expiresAt ? new Date(r.expiresAt).getTime() : 0;
        const t = Math.max(reqTime, appTime, expTime);
        if (t > maxTimestamp) maxTimestamp = t;

        if (status === "APPROVED") {
          activeGrants.push({
            requestId: r.id,
            patientMedOrgId: r.patient?.medOrgId || "",
            status: "APPROVED",
            expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
          });
        }
      }

      const accessVersion = `v-${maxTimestamp}-P${counts.PENDING}-A${counts.APPROVED}-D${counts.DENIED}-E${counts.EXPIRED}-R${counts.REVOKED}`;

      return res.json({
        userType: "DOCTOR",
        unreadNotifications,
        accessVersion,
        activeGrants,
      });
    }
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Failed to retrieve live status" });
  }
});

export default router;
