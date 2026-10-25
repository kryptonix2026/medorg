import { Router, Request, Response } from "express";
import { prisma } from "../db/prisma";
import { config } from "../config";
import { storage } from "../storage";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const router = Router();

// Check if DB viewer is enabled
function checkDbViewerEnabled(): boolean {
  if (!config.enableDbViewer) {
    return false;
  }
  // In production, check ALLOW_DB_RESET
  if (config.nodeEnv === "production" && !config.allowDbReset) {
    return false;
  }
  return true;
}

// Get database summary (masked)
router.get("/summary", async (req, res) => {
  try {
    if (!checkDbViewerEnabled()) {
      return res.status(200).json({ 
        disabled: true,
        message: "Database viewer disabled on this deployment" 
      });
    }

    // Get counts for each table
    const [patientsCount, doctorsCount, recordsCount, accessRequestsCount, sessionsCount] = await Promise.all([
      prisma.user.count(),
      prisma.doctor.count(),
      prisma.medicalRecord.count(),
      prisma.accessRequest.count(),
      prisma.session.count(),
    ]);

    // Get last N rows for each table (masked)
    const patients = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        medOrgId: true,
        name: true,
        email: true,
        nationalIdLast4: true,
        createdAt: true,
      },
    });

    const doctors = await prisma.doctor.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        doctorId: true,
        name: true,
        email: true,
        medicalLicenseNumber: true,
        hospitalName: true,
        createdAt: true,
      },
    });

    const records = await prisma.medicalRecord.findMany({
      orderBy: { uploadedAt: "desc" },
      take: 5,
      select: {
        id: true,
        title: true,
        recordType: true,
        uploadedAt: true,
      },
    });

    const accessRequests = await prisma.accessRequest.findMany({
      orderBy: { requestedAt: "desc" },
      take: 5,
      include: {
        patient: { select: { id: true, name: true, medOrgId: true } },
        doctor: { select: { id: true, name: true, doctorId: true } },
      },
    });

    const sessions = await prisma.session.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        userType: true,
        expiresAt: true,
      },
    });

    // Mask sensitive data
    const maskedPatients = patients.map(p => ({
      ...p,
      medOrgId: p.medOrgId,
      name: p.name,
      email: p.email ? `${p.email.split("@")[0]}•••@${p.email.split("@")[1]}` : "hidden",
      nationalIdLast4: p.nationalIdLast4,
    }));

    const maskedDoctors = doctors.map(d => ({
      ...d,
      doctorId: d.doctorId,
      name: d.name,
      email: d.email ? `${d.email.split("@")[0]}•••@${d.email.split("@")[1]}` : "hidden",
      medicalLicenseNumber: d.medicalLicenseNumber,
      hospitalName: d.hospitalName,
    }));

    const maskedRecords = records.map(r => ({
      ...r,
      title: r.title,
    }));

    const maskedAccessRequests = accessRequests.map(ar => ({
      ...ar,
      patient: ar.patient ? {
        ...ar.patient,
        medOrgId: ar.patient.medOrgId,
        name: ar.patient.name,
      } : null,
      doctor: ar.doctor ? {
        ...ar.doctor,
        doctorId: ar.doctor.doctorId,
        name: ar.doctor.name,
      } : null,
    }));

    const maskedSessions = sessions.map(s => ({
      ...s,
      // Don't show token hash, just user type and expiry
    }));

    res.json({ 
      disabled: false,
      counts: {
        patients: patientsCount,
        doctors: doctorsCount,
        records: recordsCount,
        accessRequests: accessRequestsCount,
        sessions: sessionsCount,
      },
      patients: maskedPatients,
      doctors: maskedDoctors,
      records: maskedRecords,
      accessRequests: maskedAccessRequests,
      sessions: maskedSessions,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Reset database (wipe + reseed + clear uploads)
router.post("/reset", async (req: any, res: Response) => {
  try {
    if (!config.allowDbReset) {
      return res.status(403).json({ error: "Database reset not allowed" });
    }
    if (config.neonBranch === "production" && !config.allowProductionReset) {
      return res.status(403).json({
        error: "Database reset refused on Neon production branch without ALLOW_PRODUCTION_RESET=true"
      });
    }

    // Wipe all data
    await prisma.session.deleteMany({});
    await prisma.accessRequest.deleteMany({});
    await prisma.medicalRecord.deleteMany({});
    await prisma.notification.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.otpSession.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.doctor.deleteMany({});

    // Clear uploads via storage abstraction
    await storage.deleteAll();

    // Reseed with seed data
    // Patients
    await prisma.user.create({
      data: {
        medOrgId: "MED-000001",
        name: "Meera Raghavan",
        email: "meera.raghavan@example.com",
        dateOfBirth: "1985-03-15",
        nationalIdHash: crypto.createHash("sha256").update("123456789012").digest("hex"),
        nationalIdLast4: "1234",
      },
    });

    await prisma.user.create({
      data: {
        medOrgId: "MED-000002",
        name: "Thomas Keller",
        email: "thomas.keller@example.com",
        dateOfBirth: "1970-01-01",
        nationalIdHash: crypto.createHash("sha256").update("987654321098").digest("hex"),
        nationalIdLast4: "9876",
      },
    });

    // Doctors
    await prisma.doctor.create({
      data: {
        doctorId: "DOC-0001",
        name: "Dr. Aisha Nair",
        email: "a.nair@example.com",
        medicalLicenseNumber: "REG-2024-8841",
        hospitalName: "St. Helena Medical Center",
      },
    });

    await prisma.doctor.create({
      data: {
        doctorId: "DOC-0002",
        name: "Dr. Rafael Ortiz",
        email: "r.ortiz@example.com",
        medicalLicenseNumber: "REG-2024-9127",
        hospitalName: "Bayview General Hospital",
      },
    });

    // Create an approved access request
    const meera = await prisma.user.findUnique({ where: { medOrgId: "MED-000001" } });
    const aisha = await prisma.doctor.findUnique({ where: { doctorId: "DOC-0001" } });

    if (meera && aisha) {
      await prisma.accessRequest.create({
        data: {
          patientId: meera.id,
          doctorId: aisha.id,
          status: "APPROVED",
          requestedAt: new Date(),
          approvedAt: new Date(),
          accessDuration: "7d",
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        },
      });
    }

    // Create a denied access request
    const thomas = await prisma.user.findUnique({ where: { medOrgId: "MED-000002" } });

    if (thomas && aisha) {
      await prisma.accessRequest.create({
        data: {
          patientId: thomas.id,
          doctorId: aisha.id,
          status: "DENIED",
          accessDuration: "7d",
          requestedAt: new Date(),
        },
      });
    }

    // Create an expired access request
    if (meera && aisha) {
      await prisma.accessRequest.create({
        data: {
          patientId: meera.id,
          doctorId: aisha.id,
          status: "EXPIRED",
          accessDuration: "7d",
          requestedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
        },
      });
    }

    // Create welcome notifications
    if (meera) {
      await prisma.notification.create({
        data: {
          userType: "PATIENT",
          userId: meera.id,
          type: "WELCOME",
          title: "Welcome to MedOrg",
          message: "Your medical records are now secure with MedOrg.",
        },
      });
    }

    if (thomas) {
      await prisma.notification.create({
        data: {
          userType: "PATIENT",
          userId: thomas.id,
          type: "WELCOME",
          title: "Welcome to MedOrg",
          message: "Your medical records are now secure with MedOrg.",
        },
      });
    }

    if (aisha) {
      await prisma.notification.create({
        data: {
          userType: "DOCTOR",
          userId: aisha.id,
          type: "WELCOME",
          title: "Welcome to MedOrg",
          message: "Your doctor portal is now active.",
        },
      });
    }

    res.json({ success: true, message: "Database reset and reseeded" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;