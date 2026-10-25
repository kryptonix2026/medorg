import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { prisma } from "../db/prisma";

declare global {
  namespace Express {
    interface Request {
      user?: {
        userType: "PATIENT" | "DOCTOR";
        userId: string;
        token: string;
      };
    }
  }
}

// Helper: extract token from Authorization header or cookie
function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }
  return null;
}

// Helper: hash token with SHA-256
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Require authentication
export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = extractToken(req);
    
    if (!token) {
      return res.status(401).json({ error: "Session expired or not provided" });
    }

    const tokenHash = hashToken(token);
    
    const session = await prisma.session.findFirst({
      where: { tokenHash },
    });

    if (!session) {
      return res.status(401).json({ error: "Session expired or not provided" });
    }

    if (new Date() > session.expiresAt) {
      await prisma.session.delete({ where: { id: session.id } });
      return res.status(401).json({ error: "Session expired" });
    }

    req.user = {
      userType: session.userType as "PATIENT" | "DOCTOR",
      userId: session.userId,
      token,
    };

    next();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Require patient access (for doctor accessing patient records)
export const requirePatientAccess = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = extractToken(req);
    
    if (!token) {
      return res.status(401).json({ error: "Session expired or not provided" });
    }

    const tokenHash = hashToken(token);
    
    const session = await prisma.session.findFirst({
      where: { tokenHash },
    });

    if (!session) {
      return res.status(401).json({ error: "Session expired or not provided" });
    }

    if (new Date() > session.expiresAt) {
      await prisma.session.delete({ where: { id: session.id } });
      return res.status(401).json({ error: "Session expired" });
    }

    // Get target patient ID from route params or body
    const targetPatientId = req.params.patientId || req.body.patientId;
    
    if (!targetPatientId) {
      return res.status(400).json({ error: "Patient ID is required" });
    }

    // If the actor is the patient themselves, allow
    if (session.userType === "PATIENT" && session.userId === targetPatientId) {
      req.user = {
        userType: session.userType as "PATIENT" | "DOCTOR",
        userId: session.userId,
        token,
      };
      return next();
    }

    // If the actor is a doctor, check access requests
    if (session.userType === "DOCTOR") {
      // Find the access request for this patient-doctor pair
      const accessRequest = await prisma.accessRequest.findFirst({
        where: {
          patientId: targetPatientId,
          doctorId: session.userId,
          status: "APPROVED",
        },
      });

      if (!accessRequest) {
        return res.status(403).json({ error: "Patient access authorization is required" });
      }

      // Check if not expired
      const now = new Date();
      if (accessRequest.expiresAt && new Date(accessRequest.expiresAt) < now) {
        // Mark as expired
        await prisma.accessRequest.update({
          where: { id: accessRequest.id },
          data: { status: "EXPIRED" },
        });
        return res.status(403).json({ error: "Patient access authorization is required" });
      }

      // Check if revoked
      if (accessRequest.status === "REVOKED") {
        return res.status(403).json({ error: "Patient access authorization is required" });
      }

      req.user = {
        userType: session.userType as "PATIENT" | "DOCTOR",
        userId: session.userId,
        token,
      };
      return next();
    }

    return res.status(403).json({ error: "Patient access authorization is required" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Require doctor role
export const requireDoctor = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = extractToken(req);
    
    if (!token) {
      return res.status(401).json({ error: "Session expired or not provided" });
    }

    const tokenHash = hashToken(token);
    
    const session = await prisma.session.findFirst({
      where: { tokenHash },
    });

    if (!session || session.userType !== "DOCTOR") {
      return res.status(401).json({ error: "Doctor access required" });
    }

    if (new Date() > session.expiresAt) {
      await prisma.session.delete({ where: { id: session.id } });
      return res.status(401).json({ error: "Session expired" });
    }

    req.user = {
      userType: session.userType as "PATIENT" | "DOCTOR",
      userId: session.userId,
      token,
    };

    next();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Require patient role
export const requirePatient = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = extractToken(req);
    
    if (!token) {
      return res.status(401).json({ error: "Session expired or not provided" });
    }

    const tokenHash = hashToken(token);
    
    const session = await prisma.session.findFirst({
      where: { tokenHash },
    });

    if (!session || session.userType !== "PATIENT") {
      return res.status(401).json({ error: "Patient access required" });
    }

    if (new Date() > session.expiresAt) {
      await prisma.session.delete({ where: { id: session.id } });
      return res.status(401).json({ error: "Session expired" });
    }

    req.user = {
      userType: session.userType as "PATIENT" | "DOCTOR",
      userId: session.userId,
      token,
    };

    next();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};