import { Router } from "express";
import { prisma } from "../db/prisma";
import { config } from "../config";
import { otpLimiter, authLimiter } from "../middleware/rateLimiter";
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

// Build safe user object (no hash exposure)
function toUserResponse(patient: any) {
  return {
    id: patient.id,
    medOrgId: patient.medOrgId,
    name: patient.name,
    email: patient.email,
    dateOfBirth: patient.dateOfBirth,
    nationalIdLast4: patient.nationalIdLast4,
  };
}

import { recordDevOtp } from "../utils/devOtp";

// Helper: send OTP email (never crashes the request)
async function sendOtpEmail(email: string, otp: string, title: string): Promise<void> {
  recordDevOtp(email, otp);
  // Always log OTP in development
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
    // Don't crash — log and continue (OTP is in console for dev)
    console.error(`Email send failed: ${err.message}`);
  }
}

router.post("/send-otp", authLimiter, async (req, res) => {
  try {
    const { email, purpose, name, nationalId, dateOfBirth } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Check for existing user (login mode) or duplicate email (register mode)
    if (purpose === "PATIENT_LOGIN") {
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (!existingUser) {
        return res.status(400).json({ error: "Email not registered" });
      }
    } else {
      // Register mode - check for duplicate email
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return res.status(409).json({ error: "Email already registered" });
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

    const title = purpose === "PATIENT_REGISTRATION" ? "MedOrg Patient Registration" : 
                  purpose === "DOCTOR_REGISTRATION" ? "MedOrg Doctor Registration" : 
                  purpose === "ACCESS_APPROVAL" ? "MedOrg Access Approval" : 
                  "MedOrg Login";

    await sendOtpEmail(email, otp, title);

    res.json({ success: true });
  } catch (error: any) {
    console.error("send-otp error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/verify-otp", authLimiter, async (req, res) => {
  try {
    const { email, purpose, otp, name, nationalId, dateOfBirth } = req.body;

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

    if (purpose === "PATIENT_REGISTRATION") {
      // Check if patient already exists (idempotent)
      let patient = await prisma.user.findUnique({ where: { email } });

      if (!patient) {
        // Generate MED-ID
        const lastPatient = await prisma.user.findFirst({
          orderBy: { medOrgId: "desc" },
        });

        let medOrgId: string;
        if (lastPatient && lastPatient.medOrgId) {
          const lastNum = parseInt(lastPatient.medOrgId.replace("MED-", ""));
          medOrgId = `MED-${String(lastNum + 1).padStart(6, "0")}`;
        } else {
          medOrgId = "MED-000001";
        }

        // Hash national ID - only store hash and last 4 digits
        const nationalIdHash = nationalId ? crypto.createHash("sha256").update(nationalId).digest("hex") : "";
        const nationalIdLast4 = nationalId ? nationalId.slice(-4) : "0000";

        patient = await prisma.user.create({
          data: {
            medOrgId,
            name,
            email,
            dateOfBirth: dateOfBirth || "",
            nationalIdHash,
            nationalIdLast4,
          },
        });
      }

      // Create session token
      const token = generateSessionToken();
      const tokenHash = hashSessionToken(token);

      await prisma.session.create({
        data: {
          tokenHash,
          userType: "PATIENT",
          userId: patient.id,
          expiresAt: new Date(Date.now() + config.sessionDays * 24 * 60 * 60 * 1000),
        },
      });

      res.json({ token, user: toUserResponse(patient) });
    }

    if (purpose === "PATIENT_LOGIN") {
      const user = await prisma.user.findUnique({ where: { email } });

      if (!user) {
        return res.status(400).json({ error: "User not found" });
      }

      const token = generateSessionToken();
      const tokenHash = hashSessionToken(token);

      await prisma.session.create({
        data: {
          tokenHash,
          userType: "PATIENT",
          userId: user.id,
          expiresAt: new Date(Date.now() + config.sessionDays * 24 * 60 * 60 * 1000),
        },
      });

      res.json({ token, user: toUserResponse(user) });
    }
  } catch (error: any) {
    console.error("verify-otp error:", error);
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