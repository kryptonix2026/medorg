import { Router } from "express";
import { prisma } from "../db/prisma";
import { config } from "../config";
import { authLimiter } from "../middleware/rateLimiter";
import crypto from "crypto";
import { sendEmail } from "../email/brevo";

const router = Router();

// Helper: hash OTP with SHA-256 + salt
function hashOtp(otp: string): string {
  const salt = config.nodeEnv === "production" ? process.env.OTP_SALT || "medorg-salt-production" : "medorg-salt-dev";
  return crypto.createHash("sha256").update(otp + salt).digest("hex");
}

// Helper: verify OTP hash
function verifyOtpHash(otp: string, hash: string): boolean {
  const expected = hashOtp(otp);
  return expected === hash;
}

// Helper: generate session token (256-bit random)
function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("base64");
}

// Helper: hash session token
function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Build safe doctor object
function toDoctorResponse(doctor: any) {
  return {
    id: doctor.id,
    doctorId: doctor.doctorId,
    name: doctor.name,
    email: doctor.email,
    medicalLicenseNumber: doctor.medicalLicenseNumber,
    hospitalName: doctor.hospitalName,
  };
}

import { recordDevOtp } from "../utils/devOtp";

// Helper: send OTP email (never crashes the request)
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

// Check if license number already exists (debounced availability check)
router.get("/license-status", authLimiter, async (req, res) => {
  try {
    const { license } = req.query;
    if (!license) {
      return res.status(400).json({ error: "License number is required" });
    }

    const exists = await prisma.doctor.findUnique({
      where: { medicalLicenseNumber: String(license) },
    });

    res.json({ available: !exists, message: exists ? "License already registered" : "Available" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/send-otp", authLimiter, async (req, res) => {
  try {
    const { email, purpose, name, licenseNumber, hospitalName } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Check for existing doctor (login mode) or duplicate email (register mode)
    if (purpose === "DOCTOR_LOGIN") {
      const existingDoctor = await prisma.doctor.findUnique({ where: { email } });
      if (!existingDoctor) {
        return res.status(400).json({ error: "Email not registered" });
      }
    } else {
      // Register mode - check for duplicate email
      const existingDoctor = await prisma.doctor.findUnique({ where: { email } });
      if (existingDoctor) {
        return res.status(409).json({ error: "Email already registered" });
      }

      // Validate license number is provided and unique
      if (!licenseNumber) {
        return res.status(400).json({ error: "Medical license number is required" });
      }

      const licenseExists = await prisma.doctor.findUnique({
        where: { medicalLicenseNumber: licenseNumber },
      });

      if (licenseExists) {
        return res.status(409).json({ error: "License number already registered" });
      }
    }

    // Check for existing OTP session
    const existingOtp = await prisma.otpSession.findFirst({
      where: { email, purpose },
    });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = hashOtp(otp);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    if (existingOtp) {
      await prisma.otpSession.update({
        where: { id: existingOtp.id },
        data: { otpHash, expiresAt, attempts: 0 },
      });
    } else {
      await prisma.otpSession.create({
        data: { email, purpose, otpHash, expiresAt, attempts: 0 },
      });
    }

    const title = purpose === "DOCTOR_REGISTRATION" ? "MedOrg Doctor Registration" : 
                  purpose === "DOCTOR_LOGIN" ? "MedOrg Doctor Login" : "MedOrg Login";

    await sendOtpEmail(email, otp, title);

    res.json({ success: true });
  } catch (error: any) {
    console.error("doctor send-otp error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/verify-otp", authLimiter, async (req, res) => {
  try {
    const { email, purpose, otp, name, licenseNumber, hospitalName } = req.body;

    if (!email || !purpose || !otp) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const otpSession = await prisma.otpSession.findFirst({
      where: { email, purpose },
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

    if (!verifyOtpHash(otp, otpSession.otpHash)) {
      await prisma.otpSession.update({
        where: { id: otpSession.id },
        data: { attempts: otpSession.attempts + 1 },
      });
      return res.status(400).json({ error: "Invalid OTP" });
    }

    // Mark as verified
    await prisma.otpSession.update({
      where: { id: otpSession.id },
      data: { verified: true },
    });

    if (purpose === "DOCTOR_REGISTRATION") {
      // Check if doctor already exists (idempotent)
      let doctor = await prisma.doctor.findUnique({ where: { email } });

      if (!doctor) {
        // Generate DOC-ID
        const lastDoctor = await prisma.doctor.findFirst({
          orderBy: { doctorId: "desc" },
        });

        let doctorId: string;
        if (lastDoctor && lastDoctor.doctorId) {
          const lastNum = parseInt(lastDoctor.doctorId.replace("DOC-", ""));
          doctorId = `DOC-${String(lastNum + 1).padStart(4, "0")}`;
        } else {
          doctorId = "DOC-0001";
        }

        doctor = await prisma.doctor.create({
          data: {
            doctorId,
            name,
            email,
            medicalLicenseNumber: licenseNumber,
            hospitalName,
          },
        });
      }

      // Create session token
      const token = generateSessionToken();
      const tokenHash = hashSessionToken(token);

      await prisma.session.create({
        data: {
          tokenHash,
          userType: "DOCTOR",
          userId: doctor.id,
          expiresAt: new Date(Date.now() + config.sessionDays * 24 * 60 * 60 * 1000),
        },
      });

      res.json({ token, user: toDoctorResponse(doctor) });
    }

    if (purpose === "DOCTOR_LOGIN") {
      const doctor = await prisma.doctor.findUnique({ where: { email } });

      if (!doctor) {
        return res.status(400).json({ error: "Doctor not found" });
      }

      const token = generateSessionToken();
      const tokenHash = hashSessionToken(token);

      await prisma.session.create({
        data: {
          tokenHash,
          userType: "DOCTOR",
          userId: doctor.id,
          expiresAt: new Date(Date.now() + config.sessionDays * 24 * 60 * 60 * 1000),
        },
      });

      res.json({ token, user: toDoctorResponse(doctor) });
    }
  } catch (error: any) {
    console.error("doctor verify-otp error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/logout", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (token) {
      const tokenHash = hashSessionToken(token);
      await prisma.session.deleteMany({ where: { tokenHash } });
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;