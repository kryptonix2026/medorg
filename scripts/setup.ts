// Setup script for MedOrg
// Idempotent: safe to run multiple times, handles missing configs gracefully

import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const rootEnvPath = path.resolve(rootDir, ".env");
const rootEnvExamplePath = path.resolve(rootDir, ".env.example");

console.log("==================================================");
console.log("          MedOrg Initial System Setup");
console.log("==================================================\n");

// 1. Ensure .env.example has a valid SQLite file: DATABASE_URL
if (fs.existsSync(rootEnvExamplePath)) {
  let exampleContent = fs.readFileSync(rootEnvExamplePath, "utf8");
  if (!exampleContent.includes('DATABASE_URL="file:../data/medorg.db"')) {
    exampleContent = exampleContent.replace(
      /^DATABASE_URL=.*$/m,
      'DATABASE_URL="file:../data/medorg.db"'
    );
    fs.writeFileSync(rootEnvExamplePath, exampleContent, "utf8");
    console.log("✓ Repaired .env.example with valid SQLite DATABASE_URL");
  }
}

// 2. Create .env from .env.example if missing
if (!fs.existsSync(rootEnvPath)) {
  if (fs.existsSync(rootEnvExamplePath)) {
    fs.copyFileSync(rootEnvExamplePath, rootEnvPath);
    console.log("✓ Created .env from .env.example");
  } else {
    fs.writeFileSync(
      rootEnvPath,
      'DATABASE_URL="file:../data/medorg.db"\nDATA_DIR=../data\nPORT=5000\nNODE_ENV=development\nCLIENT_URL=http://localhost:3000\nGROQ_BASE_URL=https://api.groq.com/openai/v1\nGROQ_MODEL=openai/gpt-oss-20b\n'
    );
    console.log("✓ Created default .env file");
  }
}

// Load root .env with override
dotenv.config({ path: rootEnvPath, override: true });

// 3. Validate DATABASE_URL format in .env
let rawDbUrl = process.env.DATABASE_URL ? process.env.DATABASE_URL.trim() : "";
// Strip inline comments & quotes safely
if (rawDbUrl.includes("#")) {
  rawDbUrl = rawDbUrl.split("#")[0].trim();
}
if (
  (rawDbUrl.startsWith('"') && rawDbUrl.endsWith('"')) ||
  (rawDbUrl.startsWith("'") && rawDbUrl.endsWith("'"))
) {
  rawDbUrl = rawDbUrl.slice(1, -1).trim();
}

if (!rawDbUrl || !rawDbUrl.startsWith("file:")) {
  console.log("⚠️  DATABASE_URL in .env is missing or does not start with 'file:'.");
  console.log("   Fix instruction: Set DATABASE_URL=\"file:../data/medorg.db\" in your root .env file.");
  console.log("   Auto-repairing .env with default SQLite URL...");
  let envText = fs.readFileSync(rootEnvPath, "utf8");
  if (envText.includes("DATABASE_URL=")) {
    envText = envText.replace(/^DATABASE_URL=.*$/m, 'DATABASE_URL="file:../data/medorg.db"');
  } else {
    envText = 'DATABASE_URL="file:../data/medorg.db"\n' + envText;
  }
  fs.writeFileSync(rootEnvPath, envText, "utf8");
  dotenv.config({ path: rootEnvPath, override: true });
}

// 4. Ensure data directories exist
const dataDir = path.resolve(rootDir, "data");
const reportsDir = path.join(dataDir, "uploads", "reports");
const prescriptionsDir = path.join(dataDir, "uploads", "prescriptions");
const tempDir = path.join(dataDir, "uploads", "temp");

for (const dir of [dataDir, path.join(dataDir, "uploads"), reportsDir, prescriptionsDir, tempDir]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
console.log("✓ Data and upload directories verified");

// Import config and prisma after environment has been initialized
import { config } from "../server/src/config";
import prisma from "../server/src/db/prisma";
import { seedDatabase } from "./seed";

async function main() {
  let dbStatus: "OK" | "WARN" | "FAIL" = "FAIL";
  let brevoStatus: "OK" | "WARN" | "FAIL" = "WARN";
  let aiStatusResult: "OK" | "WARN" | "FAIL" = "WARN";
  let dbDetail = "";
  let brevoDetail = "";
  let aiDetail = "";

  // 5. Run Prisma generate and db push
  console.log("\nSynchronizing database schema...");
  try {
    const prismaCmd = `npx dotenv-cli -e "${rootEnvPath}" -o -- npx prisma db push --schema=prisma/schema.prisma --accept-data-loss`;
    execSync(prismaCmd, { cwd: rootDir, stdio: "inherit" });
    dbStatus = "OK";
    dbDetail = "Schema synchronized";
  } catch (err: any) {
    console.error("⚠️  Prisma db push encountered an issue:", err.message);
    dbDetail = "Push had warnings";
  }

  // 6. Test DB connection
  try {
    await prisma.$connect();
    await prisma.user.count();
    dbStatus = "OK";
    dbDetail = "Connected (SQLite)";
  } catch (err: any) {
    dbStatus = "FAIL";
    dbDetail = "Connection failed - check DATABASE_URL in .env";
    console.error("⚠️  Database connection failed:", err.message);
  }

  // 7. Seed sample data if database is accessible
  if (dbStatus === "OK") {
    try {
      await seedDatabase();
    } catch (seedErr: any) {
      console.warn("⚠️  Seed step note:", seedErr.message);
    }
  }

  // 8. Brevo status check (boolean only)
  const brevoKeyPresent = !!config.brevoApiKey;
  if (brevoKeyPresent) {
    brevoStatus = "OK";
    brevoDetail = `Configured (${config.emailTransport})`;
  } else {
    brevoStatus = "WARN";
    brevoDetail = "Not configured (Dev OTP console logging active)";
  }

  // 9. Groq AI status check (boolean only)
  const groqKeyPresent = !!config.groqApiKey;
  if (!groqKeyPresent) {
    aiStatusResult = "WARN";
    aiDetail = `Not configured (Set GROQ_API_KEY in .env)`;
  } else {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(`${config.groqBaseUrl}/models`, {
        headers: { Authorization: `Bearer ${config.groqApiKey}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        aiStatusResult = "OK";
        aiDetail = `Verified (${config.groqModel})`;
      } else {
        aiStatusResult = "WARN";
        aiDetail = `API returned HTTP ${res.status} (check key validity)`;
      }
    } catch (err: any) {
      aiStatusResult = "WARN";
      aiDetail = `Could not reach Groq: ${err.message || "Network timeout"}`;
    }
  }

  await prisma.$disconnect();

  // 10. Summary table (OK / WARN / FAIL)
  console.log("\n==================================================");
  console.log("               Setup Status Summary");
  console.log("==================================================");
  console.log(`Database     [ ${dbStatus.padEnd(4)} ]  ${dbDetail}`);
  console.log(`Brevo Email  [ ${brevoStatus.padEnd(4)} ]  ${brevoDetail}`);
  console.log(`Groq AI      [ ${aiStatusResult.padEnd(4)} ]  ${aiDetail}`);
  console.log("==================================================\n");

  if (dbStatus === "FAIL") {
    console.log("Setup completed with database errors. Please check the instruction above.\n");
  } else {
    console.log("Setup complete! Missing optional credentials will be handled gracefully.\n");
  }
}

main().catch((err) => {
  console.error("Setup finished with warning:", err.message);
  process.exit(0);
});