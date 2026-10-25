import { Router } from "express";
import { prisma } from "../db/prisma";
import { config } from "../config";
import { sendEmail } from "../email/brevo";
import crypto from "crypto";

const router = Router();

// Same salt logic as patientAuth.ts
function hashOtp(otp: string): string {
  const salt = config.nodeEnv === "production" ? process.env.OTP_SALT || "medorg-salt-production" : "medorg-salt-dev";
  return crypto.createHash("sha256").update(otp + salt).digest("hex");
}

// Helper: send notification (never crashes)
async function sendAccessNotification(
  userType: "PATIENT" | "DOCTOR",
  userId: string,
  type: string,
  title: string,
  message: string
) {
  try {
    if (userType === "PATIENT") {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user) {
        await prisma.notification.create({
          data: { userType: "PATIENT", userId, type, title, message },
        });
      }
    } else {
      const doctor = await prisma.doctor.findUnique({ where: { id: userId } });
      if (doctor) {
        await prisma.notification.create({
          data: { userType: "DOCTOR", userId, type, title, message },
        });
      }
    }
  } catch (err: any) {
    console.error("Notification error:", err.message);
  }
}

import { recordDevOtp } from "../utils/devOtp";

// Helper: send OTP email (never crashes, logs in dev)
async function sendOtpEmail(email: string, otp: string, title: string): Promise<void> {
  recordDevOtp(email, otp);
  if (config.nodeEnv !== "production") {
    console.log(`\n📧 [DEV] OTP for ${email}: ${otp}`);
    console.log(`   Subject: ${title}\n`);
  }

  try {
    await sendEmail({
      to: email,
      subject: `${title} - MedOrg OTP`,
      text: `Your OTP is: ${otp}. It expires in 10 minutes.`,
    });
  } catch (err: any) {
    console.error(`Email send failed: ${err.message}`);
  }
}

router.post("/request", async (req: any, res) => {
  try {
    const { patientMedOrgId } = req.body;
    const doctorId = req.user?.userId;

    if (!patientMedOrgId || !doctorId) {
      return res.status(400).json({ error: "Patient MedOrg ID and Doctor ID are required" });
    }

    const patient = await prisma.user.findUnique({ where: { medOrgId: patientMedOrgId } });
    if (!patient) {
      return res.status(404).json({ error: "Patient not found" });
    }

    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor) {
      return res.status(404).json({ error: "Doctor not found" });
    }

    const existingRequest = await prisma.accessRequest.findFirst({
      where: {
        patientId: patient.id,
        doctorId: doctor.id,
        status: "PENDING",
      },
    });

    if (existingRequest) {
      return res.json({
        success: true,
        alreadyPending: true,
        requestId: existingRequest.id,
        status: "PENDING",
      });
    }

    let accessRequest;
    try {
      accessRequest = await prisma.accessRequest.create({
        data: {
          patientId: patient.id,
          doctorId: doctor.id,
          status: "PENDING",
          requestedAt: new Date(),
          accessDuration: "7d",
        },
      });

      await sendAccessNotification("PATIENT", patient.id, "ACCESS_REQUESTED",
        `Access request from ${doctor.name}`,
        `Dr. ${doctor.name} has requested access to your medical records. You have 7 days to approve or deny the request.`);
    } catch (err: any) {
      // Handle concurrent double-click race safely
      const raceRequest = await prisma.accessRequest.findFirst({
        where: {
          patientId: patient.id,
          doctorId: doctor.id,
          status: "PENDING",
        },
      });
      if (raceRequest) {
        return res.json({
          success: true,
          alreadyPending: true,
          requestId: raceRequest.id,
          status: "PENDING",
        });
      }
      throw err;
    }

    res.json({ 
      success: true, 
      requestId: accessRequest.id,
      status: "PENDING" 
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/doctor/mine", async (req: any, res) => {
  try {
    const doctorId = req.user?.userId;
    
    if (!doctorId) {
      return res.status(400).json({ error: "Doctor ID is required" });
    }

    const requests = await prisma.accessRequest.findMany({
      where: { doctorId },
      include: {
        patient: {
          select: { id: true, name: true, medOrgId: true },
        },
      },
      orderBy: { requestedAt: "desc" },
    });

    res.json({ requests });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/patient", async (req: any, res) => {
  try {
    const patientId = req.user?.userId;
    
    if (!patientId) {
      return res.status(400).json({ error: "Patient ID is required" });
    }

    const requests = await prisma.accessRequest.findMany({
      where: { patientId },
      include: {
        doctor: {
          select: { id: true, name: true, doctorId: true },
        },
      },
      orderBy: { requestedAt: "desc" },
    });

    res.json({ requests });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/active", async (req: any, res) => {
  try {
    const doctorId = req.user?.userId;
    
    if (!doctorId) {
      return res.status(400).json({ error: "Doctor ID is required" });
    }

    const now = new Date();
    const requests = await prisma.accessRequest.findMany({
      where: {
        doctorId,
        status: "APPROVED",
        expiresAt: { gt: now },
      },
      include: {
        patient: {
          select: { id: true, name: true, medOrgId: true },
        },
      },
      orderBy: { approvedAt: "desc" },
    });

    res.json({ requests });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/approve/start", async (req: any, res) => {
  try {
    const { requestId, duration } = req.body;

    if (!requestId) {
      return res.status(400).json({ error: "Request ID is required" });
    }

    const accessRequest = await prisma.accessRequest.findUnique({
      where: { id: requestId },
    });

    if (!accessRequest) {
      return res.status(404).json({ error: "Access request not found" });
    }

    if (accessRequest.status !== "PENDING") {
      return res.status(400).json({ error: "Request is not pending" });
    }

    // Set the access duration
    const durationMap: Record<string, string> = { "24h": "24h", "3d": "3d", "7d": "7d" };
    const accessDuration = durationMap[duration] || "7d";

    const expiresAt = new Date();
    if (accessDuration === "24h") {
      expiresAt.setHours(expiresAt.getHours() + 24);
    } else if (accessDuration === "3d") {
      expiresAt.setDate(expiresAt.getDate() + 3);
    } else if (accessDuration === "7d") {
      expiresAt.setDate(expiresAt.getDate() + 7);
    }

    // Update the access request
    await prisma.accessRequest.update({
      where: { id: requestId },
      data: {
        accessDuration,
        expiresAt,
      },
    });

    // Get the patient's email to send the OTP
    const patient = await prisma.user.findUnique({ where: { id: accessRequest.patientId } });
    if (!patient) {
      return res.status(404).json({ error: "Patient not found" });
    }

    // Generate and send ACCESS_APPROVAL OTP to the patient
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = hashOtp(otp);
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Delete any existing ACCESS_APPROVAL sessions for this patient
    await prisma.otpSession.deleteMany({
      where: {
        email: patient.email,
        purpose: "ACCESS_APPROVAL",
      },
    });

    await prisma.otpSession.create({
      data: {
        email: patient.email,
        purpose: "ACCESS_APPROVAL",
        otpHash,
        expiresAt: otpExpiresAt,
        attempts: 0,
      },
    });

    // Send the email (never crashes)
    await sendOtpEmail(patient.email, otp, "MedOrg Access Approval");

    res.json({ 
      success: true, 
      requestId: accessRequest.id,
      expiresAt,
      accessDuration,
      otpSent: true 
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/:id/approve", async (req: any, res) => {
  try {
    const { id: requestId } = req.params;
    const { otp } = req.body;

    if (!otp) {
      return res.status(400).json({ error: "OTP is required" });
    }

    const accessRequest = await prisma.accessRequest.findUnique({
      where: { id: requestId },
    });

    if (!accessRequest) {
      return res.status(404).json({ error: "Access request not found" });
    }

    if (accessRequest.status !== "PENDING") {
      return res.status(400).json({ error: "Request is not pending" });
    }

    // Get the patient to filter OTP session by email
    const patient = await prisma.user.findUnique({ where: { id: accessRequest.patientId } });
    if (!patient) {
      return res.status(404).json({ error: "Patient not found" });
    }

    // Check OTP - filter by this patient's email
    const otpSession = await prisma.otpSession.findFirst({
      where: {
        email: patient.email,
        purpose: "ACCESS_APPROVAL",
      },
      orderBy: { createdAt: "desc" },
    });

    if (!otpSession) {
      return res.status(400).json({ error: "OTP session not found" });
    }

    if (new Date() > otpSession.expiresAt) {
      return res.status(400).json({ error: "OTP has expired" });
    }

    if (otpSession.attempts >= 5) {
      return res.status(400).json({ error: "Maximum OTP attempts exceeded" });
    }

    // Verify using the same hash function
    const computedHash = hashOtp(otp);
    
    if (computedHash !== otpSession.otpHash) {
      await prisma.otpSession.update({
        where: { id: otpSession.id },
        data: { attempts: otpSession.attempts + 1 },
      });
      return res.status(400).json({ error: "Invalid OTP" });
    }

    // Mark OTP as verified
    await prisma.otpSession.update({
      where: { id: otpSession.id },
      data: { verified: true },
    });

    // Approve the access request
    const now = new Date();
    const expiresAt = new Date();
    if (accessRequest.accessDuration === "24h") {
      expiresAt.setHours(expiresAt.getHours() + 24);
    } else if (accessRequest.accessDuration === "3d") {
      expiresAt.setDate(expiresAt.getDate() + 3);
    } else {
      expiresAt.setDate(expiresAt.getDate() + 7);
    }

    await prisma.accessRequest.update({
      where: { id: requestId },
      data: {
        status: "APPROVED",
        approvedAt: now,
        expiresAt,
      },
    });

    // Notify the doctor (only after approval is confirmed)
    await sendAccessNotification("DOCTOR", accessRequest.doctorId, "ACCESS_APPROVED",
      `Access approved`,
      `Patient's medical records are now accessible for ${accessRequest.accessDuration}.`);

    // Notify the patient
    await sendAccessNotification("PATIENT", patient.id, "ACCESS_APPROVED",
      "Access Approved",
      `You approved access to your medical records. The access will expire on ${expiresAt.toLocaleDateString()}.`);

    res.json({ 
      success: true, 
      status: "APPROVED",
      expiresAt,
      accessDuration: accessRequest.accessDuration 
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/:id/deny", async (req: any, res) => {
  try {
    const { id: requestId } = req.params;

    const accessRequest = await prisma.accessRequest.findUnique({
      where: { id: requestId },
    });

    if (!accessRequest) {
      return res.status(404).json({ error: "Access request not found" });
    }

    await prisma.accessRequest.update({
      where: { id: requestId },
      data: { status: "DENIED" },
    });

    // Notify the doctor
    await sendAccessNotification("DOCTOR", accessRequest.doctorId, "ACCESS_DENIED",
      "Access Denied",
      `The patient denied your access request.`);

    // Notify the patient
    const patient = await prisma.user.findUnique({ where: { id: accessRequest.patientId } });
    if (patient) {
      await sendAccessNotification("PATIENT", patient.id, "ACCESS_DENIED",
        "Access Denied",
        `You denied the access request.`);
    }

    res.json({ success: true, status: "DENIED" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/:id/revoke", async (req: any, res) => {
  try {
    const { id: requestId } = req.params;

    const accessRequest = await prisma.accessRequest.findUnique({
      where: { id: requestId },
    });

    if (!accessRequest) {
      return res.status(404).json({ error: "Access request not found" });
    }

    await prisma.accessRequest.update({
      where: { id: requestId },
      data: { status: "REVOKED" },
    });

    // Notify the doctor
    await sendAccessNotification("DOCTOR", accessRequest.doctorId, "ACCESS_REVOKED",
      "Access Revoked",
      `The patient revoked your access to their medical records.`);

    res.json({ success: true, status: "REVOKED" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;