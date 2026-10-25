// Seed script for MedOrg
// Idempotent: safe to run multiple times

import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const rootEnvPath = path.resolve(rootDir, ".env");
const neonEnvPath = path.resolve(rootDir, ".env.neon.local");

const initialNeonBranch = process.env.NEON_BRANCH || process.env.BRANCH;

// Load root .env
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath, override: true });
} else {
  dotenv.config({ override: true });
}

// Overlay hosted / custom env if specified
const initialDbMode = (process.env.DB_MODE || "local").toLowerCase();
const customEnv = process.env.APP_ENV_FILE
  ? path.resolve(rootDir, process.env.APP_ENV_FILE)
  : (initialDbMode === "hosted" && fs.existsSync(neonEnvPath) ? neonEnvPath : null);

if (customEnv && fs.existsSync(customEnv)) {
  dotenv.config({ path: customEnv, override: true });
}

if (initialNeonBranch) {
  process.env.NEON_BRANCH = initialNeonBranch;
}

import prisma from "../server/src/db/prisma";
import { storage } from "../server/src/storage";
import { generateClinicalPdf, SAMPLE_RECORD_DATA } from "./pdfHelper";

export async function seedDatabase() {
  console.log("MedOrg Database Seed");
  console.log("=".repeat(50));

  // Check if database already has data (idempotent check)
  const patientCount = await prisma.user.count();
  const doctorCount = await prisma.doctor.count();

  if (patientCount > 0 || doctorCount > 0) {
    console.log("Database already has seed data. Skipping seed.");
    console.log("Use db:reset to wipe and reseed.");
    return;
  }

  // Patients
  const meera = await prisma.user.create({
    data: {
      medOrgId: "MED-000001",
      name: "Meera Raghavan",
      email: "meera.raghavan@example.com",
      dateOfBirth: "1985-03-15",
      nationalIdHash: crypto.createHash("sha256").update("123456789012").digest("hex"),
      nationalIdLast4: "1234",
    },
  });

  const thomas = await prisma.user.create({
    data: {
      medOrgId: "MED-000002",
      name: "Thomas Keller",
      email: "thomas.keller@example.com",
      dateOfBirth: "1970-01-01",
      nationalIdHash: crypto.createHash("sha256").update("987654321098").digest("hex"),
      nationalIdLast4: "9876",
    },
  });

  console.log(`Created patients: ${meera.medOrgId}, ${thomas.medOrgId}`);

  // Doctors
  const aisha = await prisma.doctor.create({
    data: {
      doctorId: "DOC-0001",
      name: "Dr. Aisha Nair",
      email: "a.nair@example.com",
      medicalLicenseNumber: "REG-2024-8841",
      hospitalName: "St. Helena Medical Center",
    },
  });

  const rafael = await prisma.doctor.create({
    data: {
      doctorId: "DOC-0002",
      name: "Dr. Rafael Ortiz",
      email: "r.ortiz@example.com",
      medicalLicenseNumber: "REG-2024-9127",
      hospitalName: "Bayview General Hospital",
    },
  });

  console.log(`Created doctors: ${aisha.doctorId}, ${rafael.doctorId}`);

  // Create an approved access request (Meera -> Aisha, 7d)
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
  console.log("Created approved access request (MED-000001 -> DOC-0001)");

  // Create a denied access request (Thomas -> Aisha)
  await prisma.accessRequest.create({
    data: {
      patientId: thomas.id,
      doctorId: aisha.id,
      status: "DENIED",
      accessDuration: "7d",
      requestedAt: new Date(),
    },
  });
  console.log("Created denied access request (MED-000002 -> DOC-0001)");

  // Create an expired access request (Meera -> Aisha)
  await prisma.accessRequest.create({
    data: {
      patientId: meera.id,
      doctorId: aisha.id,
      status: "EXPIRED",
      accessDuration: "7d",
      requestedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
    },
  });
  console.log("Created expired access request (MED-000001 -> DOC-0001)");

  // Welcome notifications
  await prisma.notification.create({
    data: {
      userType: "PATIENT",
      userId: meera.id,
      type: "WELCOME",
      title: "Welcome to MedOrg",
      message: "Your medical records are now secure with MedOrg.",
    },
  });

  await prisma.notification.create({
    data: {
      userType: "PATIENT",
      userId: thomas.id,
      type: "WELCOME",
      title: "Welcome to MedOrg",
      message: "Your medical records are now secure with MedOrg.",
    },
  });

  await prisma.notification.create({
    data: {
      userType: "DOCTOR",
      userId: aisha.id,
      type: "WELCOME",
      title: "Welcome to MedOrg",
      message: "Your doctor portal is now active.",
    },
  });

  // Sample PDF records with real selectable text
  const sampleRecords = [
    {
      patientId: meera.id,
      doctorId: aisha.id,
      recordType: "REPORT" as const,
      title: "Complete Blood Count, March Report",
      description: "Blood test results from March 2024 visit",
    },
    {
      patientId: meera.id,
      doctorId: aisha.id,
      recordType: "PRESCRIPTION" as const,
      title: "Lisinopril 10mg - Monthly Refill",
      description: "Blood pressure medication refill",
    },
    {
      patientId: thomas.id,
      doctorId: rafael.id,
      recordType: "REPORT" as const,
      title: "MRI Brain Scan Results",
      description: "Neurology follow-up from April 2024",
    },
    {
      patientId: thomas.id,
      doctorId: rafael.id,
      recordType: "PRESCRIPTION" as const,
      title: "Metformin 500mg - Daily Dosage",
      description: "Diabetes medication",
    },
  ];

  for (const recordData of sampleRecords) {
    const sampleConfig = SAMPLE_RECORD_DATA[recordData.title];
    let pdfBuffer: Buffer;
    if (sampleConfig) {
      pdfBuffer = await generateClinicalPdf(sampleConfig);
    } else {
      pdfBuffer = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");
    }

    const subDir = recordData.recordType === "REPORT" ? "reports" : "prescriptions";
    const uploadResult = await storage.upload({
      buffer: pdfBuffer,
      originalFileName: `${recordData.title}.pdf`,
      mimeType: "application/pdf",
      subDir,
    });

    await prisma.medicalRecord.create({
      data: {
        patientId: recordData.patientId,
        doctorId: recordData.doctorId,
        recordType: recordData.recordType,
        title: recordData.title,
        description: recordData.description,
        originalFileName: `${recordData.title}.pdf`,
        storedFileName: uploadResult.storedFileName,
        filePath: uploadResult.filePath,
        mimeType: "application/pdf",
        fileSize: uploadResult.fileSize,
      },
    });

    console.log(`Created ${recordData.recordType.toLowerCase()} record with selectable text: ${recordData.title}`);
  }

  console.log("\n" + "=".repeat(50));
  console.log("Database seeded successfully!");
  console.log("\nSeed accounts:");
  console.log("  Patient: meera.raghavan@example.com (MED-000001)");
  console.log("  Patient: thomas.keller@example.com (MED-000002)");
  console.log("  Doctor: a.nair@example.com (DOC-0001, St. Helena Medical Center)");
  console.log("  Doctor: r.ortiz@example.com (DOC-0002, Bayview General Hospital)");
}

if (process.argv[1] && process.argv[1].endsWith("seed.ts")) {
  seedDatabase()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}