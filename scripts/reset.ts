// Reset script for MedOrg
// Wipes all data, clears storage, and reseeds with seed data

import path from "path";
import fs from "fs";
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
import { seedDatabase } from "./seed";

export async function resetDatabase() {
  console.log("MedOrg Database Reset");
  console.log("=".repeat(50));

  // Check production safety
  const neonBranch = process.env.NEON_BRANCH || process.env.BRANCH || "";
  const allowProductionReset = process.env.ALLOW_PRODUCTION_RESET === "true";

  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DB_RESET !== "true") {
    console.error("ERROR: Database reset is not allowed in production.");
    console.error("Set ALLOW_DB_RESET=true environment variable to enable.");
    process.exit(1);
  }

  if (neonBranch === "production" && !allowProductionReset) {
    console.error("ERROR: Database reset refused on Neon production branch without ALLOW_PRODUCTION_RESET=true.");
    process.exit(1);
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

  console.log("Database wiped successfully.");

  // Clear uploads across storage drivers
  await storage.deleteAll();
  console.log("Storage cleared.");

  // Reseed using seedDatabase
  await seedDatabase();
  console.log("Database reset and reseeded successfully!");
}

if (process.argv[1] && process.argv[1].endsWith("reset.ts")) {
  resetDatabase()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}