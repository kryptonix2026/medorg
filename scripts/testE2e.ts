import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const rootEnvPath = path.resolve(rootDir, ".env");

// Enable OTP dev log before loading config
process.env.OTP_DEV_LOG = "true";
process.env.NODE_ENV = "development";

if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath, override: true });
} else {
  dotenv.config({ override: true });
}

const neonEnvPath = path.resolve(rootDir, ".env.neon.local");
const initialDbMode = (process.env.DB_MODE || "local").toLowerCase();
const customEnv = process.env.APP_ENV_FILE
  ? path.resolve(rootDir, process.env.APP_ENV_FILE)
  : (initialDbMode === "hosted" && fs.existsSync(neonEnvPath) ? neonEnvPath : null);

if (customEnv && fs.existsSync(customEnv)) {
  dotenv.config({ path: customEnv, override: true });
}

process.env.OTP_DEV_LOG = "true";

import { config } from "../server/src/config";
import prisma from "../server/src/db/prisma";
import { generateClinicalPdf, SAMPLE_RECORD_DATA } from "./pdfHelper";

interface TestStepResult {
  step: string;
  passed: boolean;
  detail?: string;
}

const results: TestStepResult[] = [];

function recordResult(step: string, passed: boolean, detail: string = "") {
  results.push({ step, passed, detail });
  const status = passed ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`[ ${status} ] ${step}${detail ? " - " + detail : ""}`);
}

async function runE2e() {
  console.log("==================================================");
  console.log("        MedOrg HTTP End-to-End Test Suite");
  console.log("==================================================\n");

  let serverInstance: any = null;
  let baseUrl = `http://localhost:${config.port}`;

  // Check if server is already running on port
  try {
    const healthCheck = await fetch(`${baseUrl}/api/health`);
    if (!healthCheck.ok) throw new Error("Not ok");
  } catch {
    // Start temporary test server
    const { default: expressApp } = await import("../server/src/index");
    baseUrl = `http://localhost:${config.port}`;
    await new Promise((r) => setTimeout(r, 1000));
  }

  const timestamp = Date.now();
  const testPatientEmail = `e2e.patient.${timestamp}@example.com`;
  const testDoctorEmail = `e2e.doctor.${timestamp}@example.com`;
  const testLicense = `REG-TEST-${timestamp.toString().slice(-4)}`;

  let patientToken = "";
  let patientId = "";
  let patientMedOrgId = "";
  let doctorToken = "";
  let doctorId = "";
  let accessRequestId = "";
  let uploadedRecordId = "";

  try {
    // Step 1: Health check
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      const data: any = await res.json();
      recordResult("1. API Health Check", res.status === 200 && data.status === "ok");
    } catch (e: any) {
      recordResult("1. API Health Check", false, e.message);
    }

    // Step 2: Register a new patient
    try {
      const sendRes = await fetch(`${baseUrl}/api/auth/patient/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: testPatientEmail, purpose: "PATIENT_REGISTRATION" }),
      });

      const otpRes = await fetch(`${baseUrl}/api/auth/dev-otp?email=${encodeURIComponent(testPatientEmail)}`);
      const otpData: any = await otpRes.json();

      const verifyRes = await fetch(`${baseUrl}/api/auth/patient/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: testPatientEmail,
          purpose: "PATIENT_REGISTRATION",
          otp: otpData.otp,
          name: "E2E Test Patient",
          nationalId: "123456789012",
          dateOfBirth: "1992-08-14",
        }),
      });

      const verifyData: any = await verifyRes.json();
      patientToken = verifyData.token;
      patientId = verifyData.user?.id;
      patientMedOrgId = verifyData.user?.medOrgId;

      recordResult(
        "2. Patient Registration with OTP",
        verifyRes.status === 200 && !!patientToken && !!patientMedOrgId,
        `MedOrg ID: ${patientMedOrgId}`
      );
    } catch (e: any) {
      recordResult("2. Patient Registration with OTP", false, e.message);
    }

    // Step 3: Register a new doctor
    try {
      await fetch(`${baseUrl}/api/auth/doctor/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: testDoctorEmail,
          purpose: "DOCTOR_REGISTRATION",
          licenseNumber: testLicense,
        }),
      });

      const otpRes = await fetch(`${baseUrl}/api/auth/dev-otp?email=${encodeURIComponent(testDoctorEmail)}`);
      const otpData: any = await otpRes.json();

      const verifyRes = await fetch(`${baseUrl}/api/auth/doctor/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: testDoctorEmail,
          purpose: "DOCTOR_REGISTRATION",
          otp: otpData.otp,
          name: "Dr. E2E Clinician",
          licenseNumber: testLicense,
          hospitalName: "Metropolitan General Hospital",
        }),
      });

      const verifyData: any = await verifyRes.json();
      doctorToken = verifyData.token;
      doctorId = verifyData.user?.id;

      recordResult(
        "3. Doctor Registration with OTP",
        verifyRes.status === 200 && !!doctorToken,
        `License: ${testLicense}`
      );
    } catch (e: any) {
      recordResult("3. Doctor Registration with OTP", false, e.message);
    }

    // Step 4: Test duplicate medical license registration
    try {
      const dupEmail = `dup.doc.${timestamp}@example.com`;
      const dupSendRes = await fetch(`${baseUrl}/api/auth/doctor/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: dupEmail,
          purpose: "DOCTOR_REGISTRATION",
          licenseNumber: testLicense,
        }),
      });

      recordResult(
        "4. Duplicate License Blocked",
        dupSendRes.status === 409,
        `Status ${dupSendRes.status} (409 Conflict expected)`
      );
    } catch (e: any) {
      recordResult("4. Duplicate License Blocked", false, e.message);
    }

    // Step 5: Doctor access request
    try {
      const reqRes = await fetch(`${baseUrl}/api/access/request`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${doctorToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ patientMedOrgId }),
      });

      const reqData: any = await reqRes.json();
      accessRequestId = reqData.requestId;

      recordResult(
        "5. Doctor Access Request Creation",
        reqRes.status === 200 && !!accessRequestId,
        `Request ID: ${accessRequestId}`
      );
    } catch (e: any) {
      recordResult("5. Doctor Access Request Creation", false, e.message);
    }

    // Step 6: Unauthorized read blocked (403) before approval
    try {
      const unauthAiRes = await fetch(`${baseUrl}/api/ai/summarize`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${doctorToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ patientId }),
      });

      const unauthJson: any = await unauthAiRes.json();
      const is403 =
        unauthAiRes.status === 403 &&
        unauthJson.error === "Patient access authorization is required";

      recordResult(
        "6. Unauthorized Patient Access Blocked (403)",
        is403,
        `Status ${unauthAiRes.status}: "${unauthJson.error}"`
      );
    } catch (e: any) {
      recordResult("6. Unauthorized Patient Access Blocked (403)", false, e.message);
    }

    // Step 7: Patient approval with OTP
    try {
      const startRes = await fetch(`${baseUrl}/api/access/approve/start`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${patientToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requestId: accessRequestId, duration: "7d" }),
      });

      const otpRes = await fetch(`${baseUrl}/api/auth/dev-otp?email=${encodeURIComponent(testPatientEmail)}`);
      const otpData: any = await otpRes.json();

      const approveRes = await fetch(`${baseUrl}/api/access/${accessRequestId}/approve`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${patientToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ otp: otpData.otp }),
      });

      const approveData: any = await approveRes.json();
      recordResult(
        "7. Patient Grants Access with OTP Approval",
        approveRes.status === 200 && approveData.status === "APPROVED",
        `Duration: ${approveData.accessDuration}`
      );
    } catch (e: any) {
      recordResult("7. Patient Grants Access with OTP Approval", false, e.message);
    }

    // Step 8: PDF upload by authorized doctor
    try {
      const sampleDoc = SAMPLE_RECORD_DATA["Complete Blood Count, March Report"];
      const pdfBuffer = await generateClinicalPdf(sampleDoc);

      const formData = new FormData();
      formData.append("record", new Blob([pdfBuffer], { type: "application/pdf" }), "Complete_Blood_Count.pdf");
      formData.append("patientId", patientId);
      formData.append("doctorId", doctorId);
      formData.append("recordType", "REPORT");
      formData.append("title", "Complete Blood Count, March Report");
      formData.append("description", "Routine annual evaluation");

      const uploadRes = await fetch(`${baseUrl}/api/records/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${doctorToken}`,
        },
        body: formData,
      });

      const uploadData: any = await uploadRes.json();
      uploadedRecordId = uploadData.record?.id;

      recordResult(
        "8. Clinical PDF Document Upload",
        uploadRes.status === 200 && !!uploadedRecordId,
        `Record ID: ${uploadedRecordId}`
      );
    } catch (e: any) {
      recordResult("8. Clinical PDF Document Upload", false, e.message);
    }

    // Step 9: View and Download record
    try {
      const viewRes = await fetch(`${baseUrl}/api/records/${uploadedRecordId}/view`, {
        headers: { Authorization: `Bearer ${doctorToken}` },
      });
      const downloadRes = await fetch(`${baseUrl}/api/records/${uploadedRecordId}/download`, {
        headers: { Authorization: `Bearer ${doctorToken}` },
      });

      const viewOk = viewRes.status === 200 && viewRes.headers.get("content-type")?.includes("pdf");
      const downloadOk =
        downloadRes.status === 200 &&
        downloadRes.headers.get("content-disposition")?.includes("attachment");

      recordResult(
        "9. Document View & Download Streams",
        !!viewOk && !!downloadOk,
        "PDF inline and attachment headers verified"
      );
    } catch (e: any) {
      recordResult("9. Document View & Download Streams", false, e.message);
    }

    // Step 10: AI summary from PDF text
    try {
      const aiRes = await fetch(`${baseUrl}/api/ai/summarize`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${doctorToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ patientId }),
      });

      const aiData: any = await aiRes.json();

      if (config.groqApiKey) {
        // If configured, must be 200 with required opening line
        const pass =
          aiRes.status === 200 &&
          aiData.summary?.startsWith("Summary generated from the on-file records.") &&
          aiData.recordsUsed >= 1;
        recordResult(
          "10. AI Summary Extracted from PDF Text",
          pass,
          `Analyzed ${aiData.recordsUsed} documents`
        );
      } else {
        // If not configured, must return clean "AI is not configured"
        const pass = aiRes.status === 500 && aiData.error === "AI is not configured";
        recordResult(
          "10. AI Summary Not Configured State Handled",
          pass,
          "Gracefully reported 'AI is not configured'"
        );
      }
    } catch (e: any) {
      recordResult("10. AI Summary from PDF Text", false, e.message);
    }

    // Step 11: Revoke and immediate lockout
    try {
      const revokeRes = await fetch(`${baseUrl}/api/access/${accessRequestId}/revoke`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${patientToken}`,
        },
      });

      const lockoutRes = await fetch(`${baseUrl}/api/ai/summarize`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${doctorToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ patientId }),
      });

      const lockoutData: any = await lockoutRes.json();
      const pass =
        revokeRes.status === 200 &&
        lockoutRes.status === 403 &&
        lockoutData.error === "Patient access authorization is required";

      recordResult(
        "11. Access Revocation & Immediate Lockout",
        pass,
        "Lockout returned 403 'Patient access authorization is required'"
      );
    } catch (e: any) {
      recordResult("11. Access Revocation & Immediate Lockout", false, e.message);
    }

    // Step 12: Notifications
    try {
      const notifRes = await fetch(`${baseUrl}/api/notifications`, {
        headers: { Authorization: `Bearer ${patientToken}` },
      });
      const notifData: any = await notifRes.json();
      const hasNotifs = Array.isArray(notifData.notifications) && notifData.notifications.length > 0;

      if (hasNotifs) {
        const notifId = notifData.notifications[0].id;
        const markRes = await fetch(`${baseUrl}/api/notifications/${notifId}/read`, {
          method: "POST",
          headers: { Authorization: `Bearer ${patientToken}` },
        });
        recordResult(
          "12. Patient Notifications Flow",
          markRes.status === 200,
          `Retrieved and marked read (${notifData.notifications.length} received)`
        );
      } else {
        recordResult("12. Patient Notifications Flow", false, "No notifications found");
      }
    } catch (e: any) {
      recordResult("12. Patient Notifications Flow", false, e.message);
    }

    // Step 13: 5-tab masked database viewer
    try {
      const dbRes = await fetch(`${baseUrl}/api/database/summary`);
      const dbData: any = await dbRes.json();

      const has5Tabs =
        Array.isArray(dbData.patients) &&
        Array.isArray(dbData.doctors) &&
        Array.isArray(dbData.records) &&
        Array.isArray(dbData.accessRequests) &&
        Array.isArray(dbData.sessions);

      // Check masking: no raw nationalIdHash or tokenHash leaked
      const rawText = JSON.stringify(dbData);
      const isMasked =
        !rawText.includes("nationalIdHash") && !rawText.includes("tokenHash");

      recordResult(
        "13. 5-Tab Masked Database Viewer",
        has5Tabs && isMasked,
        "Confirmed 5 table collections, hashes strictly masked"
      );
    } catch (e: any) {
      recordResult("13. 5-Tab Masked Database Viewer", false, e.message);
    }

    // Step 14: Session Logout
    try {
      const logoutRes = await fetch(`${baseUrl}/api/auth/doctor/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${doctorToken}` },
      });
      recordResult("14. Session Logout", logoutRes.status === 200, "Doctor session terminated");
    } catch (e: any) {
      recordResult("14. Session Logout", false, e.message);
    }

    // Step 15: Database reset endpoint
    try {
      const resetRes = await fetch(`${baseUrl}/api/database/reset`, { method: "POST" });
      const resetData: any = await resetRes.json();
      recordResult(
        "15. Database Reset Endpoint",
        resetRes.status === 200 && resetData.success === true,
        "Database wiped and reseeded successfully"
      );
    } catch (e: any) {
      recordResult("15. Database Reset Endpoint", false, e.message);
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log("\n==================================================");
  console.log("            End-to-End Test Summary");
  console.log("==================================================");
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;

  console.log(`Total: ${total} | Passed: ${passed} | Failed: ${failed}`);

  if (failed === 0) {
    console.log("\n🎉 ALL 15 END-TO-END TESTS PASSED CLEANLY! 🎉\n");
    process.exit(0);
  } else {
    console.log(`\n❌ ${failed} TEST(S) FAILED. Please inspect details above.\n`);
    process.exit(1);
  }
}

runE2e().catch((e) => {
  console.error("Test execution failed:", e);
  process.exit(1);
});
