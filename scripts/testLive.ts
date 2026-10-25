import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const rootEnvPath = path.resolve(rootDir, ".env");

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

import prisma from "../server/src/db/prisma";

const port = process.env.PORT || "5000";
const baseUrl = `http://127.0.0.1:${port}`;

interface TestResult {
  name: string;
  passed: boolean;
  details?: string;
}

const results: TestResult[] = [];

function recordResult(name: string, passed: boolean, details?: string) {
  results.push({ name, passed, details });
  const status = passed ? "[ PASS ]" : "[ FAIL ]";
  console.log(`${status} ${name}${details ? ` - ${details}` : ""}`);
}

async function run() {
  console.log("==================================================");
  console.log("     MedOrg Live Status Polling Test Suite");
  console.log("==================================================\n");

  let serverInstance: any = null;

  try {
    const healthCheck = await fetch(`${baseUrl}/api/health`).catch(() => null);
    if (!healthCheck || !healthCheck.ok) {
      const serverModule = await import("../server/src/index");
      serverInstance = serverModule.default;
      await new Promise((r) => setTimeout(r, 1200));
    }
  } catch (err) {
    console.error("Server init error:", err);
  }

  const timestamp = Date.now();
  const patientEmail = `live.patient.${timestamp}@example.com`;
  const doctorEmail = `live.doctor.${timestamp}@example.com`;
  const doctorLicense = `LIVE-LIC-${timestamp.toString().slice(-4)}`;

  let patientToken = "";
  let patientMedOrgId = "";
  let patientId = "";
  let doctorToken = "";
  let doctorId = "";
  let accessRequestId = "";

  try {
    // 1. Setup Patient
    await fetch(`${baseUrl}/api/auth/patient/send-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: patientEmail, purpose: "PATIENT_REGISTRATION" }),
    });
    const pOtpRes = await fetch(`${baseUrl}/api/auth/dev-otp?email=${encodeURIComponent(patientEmail)}`);
    const pOtp = (await pOtpRes.json()).otp;
    const patientNationalId = Math.floor(100000000000 + Math.random() * 900000000000).toString();
    const pVerify = await fetch(`${baseUrl}/api/auth/patient/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: patientEmail,
        otp: pOtp,
        purpose: "PATIENT_REGISTRATION",
        name: "Live Test Patient",
        dateOfBirth: "1990-01-01",
        nationalId: patientNationalId,
      }),
    });
    const pData: any = await pVerify.json();
    patientToken = pData.token;
    patientId = pData.user.id;
    patientMedOrgId = pData.user.medOrgId;

    // 2. Setup Doctor
    await fetch(`${baseUrl}/api/auth/doctor/send-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: doctorEmail,
        purpose: "DOCTOR_REGISTRATION",
        licenseNumber: doctorLicense,
      }),
    });
    const dOtpRes = await fetch(`${baseUrl}/api/auth/dev-otp?email=${encodeURIComponent(doctorEmail)}`);
    const dOtp = (await dOtpRes.json()).otp;
    const dVerify = await fetch(`${baseUrl}/api/auth/doctor/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: doctorEmail,
        otp: dOtp,
        purpose: "DOCTOR_REGISTRATION",
        name: "Dr. Live Tester",
        licenseNumber: doctorLicense,
        hospitalName: "Metro General",
      }),
    });
    const dData: any = await dVerify.json();
    doctorToken = dData.token;
    doctorId = dData.user.id;

    // STEP 1: Initial live status for patient
    const initPatientStatusRes = await fetch(`${baseUrl}/api/live/status`, {
      headers: { Authorization: `Bearer ${patientToken}` },
    });
    const initPatientStatus: any = await initPatientStatusRes.json();
    const initialPending = initPatientStatus.pendingRequestsCount || 0;

    // Doctor requests access
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

    // Check patient's /live/status
    const postReqStatusRes = await fetch(`${baseUrl}/api/live/status`, {
      headers: { Authorization: `Bearer ${patientToken}` },
    });
    const postReqStatus: any = await postReqStatusRes.json();

    const step1Pass =
      postReqStatusRes.status === 200 &&
      postReqStatus.pendingRequestsCount === initialPending + 1 &&
      postReqStatus.accessVersion !== initPatientStatus.accessVersion &&
      postReqStatusRes.headers.get("cache-control")?.includes("no-store");

    recordResult(
      "1. Doctor Requests Access -> Patient /live/status updates pendingRequestsCount",
      !!step1Pass,
      `Pending count: ${initialPending} -> ${postReqStatus.pendingRequestsCount}, Version changed: ${postReqStatus.accessVersion}`
    );

    // STEP 2: Patient approves access
    await fetch(`${baseUrl}/api/access/approve/start`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${patientToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requestId: accessRequestId, duration: "24h" }),
    });
    const approveOtpRes = await fetch(`${baseUrl}/api/auth/dev-otp?email=${encodeURIComponent(patientEmail)}`);
    const approveOtp = (await approveOtpRes.json()).otp;
    await fetch(`${baseUrl}/api/access/${accessRequestId}/approve`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${patientToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ otp: approveOtp }),
    });

    // Check doctor's /live/status
    const docLiveRes = await fetch(`${baseUrl}/api/live/status`, {
      headers: { Authorization: `Bearer ${doctorToken}` },
    });
    const docLive: any = await docLiveRes.json();
    const activeGrant = (docLive.activeGrants || []).find((g: any) => g.requestId === accessRequestId);

    const step2Pass =
      docLiveRes.status === 200 &&
      !!activeGrant &&
      activeGrant.status === "APPROVED" &&
      activeGrant.patientMedOrgId === patientMedOrgId;

    recordResult(
      "2. Patient Approves Access -> Doctor /live/status shows grant ACTIVE",
      !!step2Pass,
      `Grant status: ${activeGrant?.status}, Patient: ${activeGrant?.patientMedOrgId}, Expires: ${activeGrant?.expiresAt}`
    );

    // STEP 3: Patient revokes access -> Doctor live status reflects end & records/AI call returns 403
    const revokeRes = await fetch(`${baseUrl}/api/access/${accessRequestId}/revoke`, {
      method: "POST",
      headers: { Authorization: `Bearer ${patientToken}` },
    });
    const revokeData: any = await revokeRes.json();

    const docRevokeLiveRes = await fetch(`${baseUrl}/api/live/status`, {
      headers: { Authorization: `Bearer ${doctorToken}` },
    });
    const docRevokeLive: any = await docRevokeLiveRes.json();
    const grantAfterRevoke = (docRevokeLive.activeGrants || []).find((g: any) => g.requestId === accessRequestId);

    // Doctor tries to access patient clinical AI/records
    const recordsForbiddenRes = await fetch(`${baseUrl}/api/ai/summarize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${doctorToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ patientId }),
    });

    const step3Pass =
      revokeRes.status === 200 &&
      grantAfterRevoke === undefined &&
      recordsForbiddenRes.status === 403;

    recordResult(
      "3. Patient Revokes -> Doctor /live/status ends grant & records return 403",
      !!step3Pass,
      `Active in doctor grants: ${!!grantAfterRevoke}, Records HTTP: ${recordsForbiddenRes.status}`
    );

    // STEP 4: Doctor requests access again after revocation -> creates PENDING request
    const patientNotifsBefore = await prisma.notification.count({ where: { userId: patientId } });

    const reReqRes = await fetch(`${baseUrl}/api/access/request`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${doctorToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ patientMedOrgId }),
    });
    const reReqData: any = await reReqRes.json();
    const newPendingId = reReqData.requestId;

    const patientNotifsAfterFirst = await prisma.notification.count({ where: { userId: patientId } });

    const step4Pass =
      reReqRes.status === 200 &&
      reReqData.status === "PENDING" &&
      !!newPendingId &&
      patientNotifsAfterFirst === patientNotifsBefore + 1;

    recordResult(
      "4. Doctor Requests Access Again -> Creates PENDING request & notifies patient once",
      !!step4Pass,
      `Status: ${reReqData.status}, Request ID: ${newPendingId}, Notifications: ${patientNotifsBefore} -> ${patientNotifsAfterFirst}`
    );

    // STEP 5: Idempotency check: Doctor sends duplicate request -> returns 200 alreadyPending without 2nd notification
    const dupReqRes = await fetch(`${baseUrl}/api/access/request`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${doctorToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ patientMedOrgId }),
    });
    const dupReqData: any = await dupReqRes.json();
    const patientNotifsAfterSecond = await prisma.notification.count({ where: { userId: patientId } });

    const step5Pass =
      dupReqRes.status === 200 &&
      dupReqData.alreadyPending === true &&
      dupReqData.requestId === newPendingId &&
      dupReqData.status === "PENDING" &&
      patientNotifsAfterSecond === patientNotifsAfterFirst; // NO second notification

    recordResult(
      "5. Idempotent Request -> Returns 200 alreadyPending with no second notification",
      !!step5Pass,
      `HTTP: ${dupReqRes.status}, alreadyPending: ${dupReqData.alreadyPending}, Notifs unchanged: ${patientNotifsAfterSecond === patientNotifsAfterFirst}`
    );

    // STEP 6: Doctor's records call is still 403 while request is pending
    const pendingLockoutRes = await fetch(`${baseUrl}/api/ai/summarize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${doctorToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ patientId }),
    });
    const step6Pass = pendingLockoutRes.status === 403;

    recordResult(
      "6. Records Access While Request Pending -> Blocked with 403",
      step6Pass,
      `HTTP Status: ${pendingLockoutRes.status}`
    );

    // STEP 7: Patient denies the request -> Status becomes DENIED
    const denyRes = await fetch(`${baseUrl}/api/access/${newPendingId}/deny`, {
      method: "POST",
      headers: { Authorization: `Bearer ${patientToken}` },
    });
    const docLiveAfterDenyRes = await fetch(`${baseUrl}/api/live/status`, {
      headers: { Authorization: `Bearer ${doctorToken}` },
    });
    const docLiveAfterDeny: any = await docLiveAfterDenyRes.json();

    const docRequestsAfterDenyRes = await fetch(`${baseUrl}/api/access/doctor/mine`, {
      headers: { Authorization: `Bearer ${doctorToken}` },
    });
    const docRequestsAfterDeny: any = await docRequestsAfterDenyRes.json();
    const deniedReq = (docRequestsAfterDeny.requests || []).find((r: any) => r.id === newPendingId);

    const step7Pass =
      denyRes.status === 200 &&
      deniedReq?.status === "DENIED" &&
      docLiveAfterDeny.accessVersion.includes("-D");

    recordResult(
      "7. Patient Denies Request -> Status reflects DENIED in doctor live requests",
      !!step7Pass,
      `Deny HTTP: ${denyRes.status}, Doctor request status: ${deniedReq?.status}`
    );

    // STEP 8: Doctor requests again after DENIED -> New PENDING request allowed
    const reReqAfterDenyRes = await fetch(`${baseUrl}/api/access/request`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${doctorToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ patientMedOrgId }),
    });
    const reReqAfterDenyData: any = await reReqAfterDenyRes.json();
    const finalRequestId = reReqAfterDenyData.requestId;

    const step8Pass =
      reReqAfterDenyRes.status === 200 &&
      reReqAfterDenyData.status === "PENDING" &&
      finalRequestId !== newPendingId;

    recordResult(
      "8. Doctor Re-Requests After Deny -> New PENDING request created",
      !!step8Pass,
      `Status: ${reReqAfterDenyData.status}, New ID: ${finalRequestId}`
    );

    // STEP 9: Patient approves the new request -> Doctor's /live/status shows ACTIVE and records access succeeds
    await fetch(`${baseUrl}/api/access/approve/start`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${patientToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requestId: finalRequestId, duration: "7d" }),
    });
    const approveOtpRes2 = await fetch(`${baseUrl}/api/auth/dev-otp?email=${encodeURIComponent(patientEmail)}`);
    const approveOtp2 = (await approveOtpRes2.json()).otp;
    await fetch(`${baseUrl}/api/access/${finalRequestId}/approve`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${patientToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ otp: approveOtp2 }),
    });

    const docLiveApprovedRes = await fetch(`${baseUrl}/api/live/status`, {
      headers: { Authorization: `Bearer ${doctorToken}` },
    });
    const docLiveApproved: any = await docLiveApprovedRes.json();
    const finalActiveGrant = (docLiveApproved.activeGrants || []).find((g: any) => g.requestId === finalRequestId);

    // Doctor accesses records/AI summary successfully
    const recordsAllowedRes = await fetch(`${baseUrl}/api/ai/summarize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${doctorToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ patientId }),
    });

    const step9Pass =
      !!finalActiveGrant &&
      finalActiveGrant.status === "APPROVED" &&
      recordsAllowedRes.status !== 403;

    recordResult(
      "9. Patient Approves -> Doctor /live/status shows grant ACTIVE & records access succeeds",
      !!step9Pass,
      `Active: ${finalActiveGrant?.status}, Records HTTP: ${recordsAllowedRes.status}`
    );

    // STEP 10: Server-side expiry evaluation
    // Create a grant whose expiresAt is in the past
    const expiredReq = await prisma.accessRequest.create({
      data: {
        patientId,
        doctorId,
        status: "APPROVED",
        accessDuration: "24h",
        requestedAt: new Date(Date.now() - 48 * 3600 * 1000),
        approvedAt: new Date(Date.now() - 48 * 3600 * 1000),
        expiresAt: new Date(Date.now() - 24 * 3600 * 1000), // Expired 24 hours ago
      },
    });

    const expiredLiveRes = await fetch(`${baseUrl}/api/live/status`, {
      headers: { Authorization: `Bearer ${doctorToken}` },
    });
    const expiredLive: any = await expiredLiveRes.json();
    const activeWithExpired = (expiredLive.activeGrants || []).find((g: any) => g.requestId === expiredReq.id);

    // Verify it is not in activeGrants and accessVersion reflects expiration
    const step10Pass =
      expiredLiveRes.status === 200 &&
      activeWithExpired === undefined &&
      expiredLive.accessVersion.includes("-E");

    recordResult(
      "10. Server-Side Expiry Evaluation -> Past expiresAt is reported as EXPIRED",
      !!step10Pass,
      `Included in activeGrants: ${!!activeWithExpired}, Version: ${expiredLive.accessVersion}`
    );

  } catch (error: any) {
    console.error("Test failure:", error);
    recordResult("Unexpected Test Exception", false, error.message);
  } finally {
    console.log("\n==================================================");
    console.log("            Live Status Test Summary");
    console.log("==================================================");
    const passedCount = results.filter((r) => r.passed).length;
    const failedCount = results.length - passedCount;
    console.log(`Total: ${results.length} | Passed: ${passedCount} | Failed: ${failedCount}\n`);

    if (failedCount === 0) {
      console.log("🎉 ALL LIVE STATUS WORKFLOW TESTS PASSED CLEANLY! 🎉\n");
    }

    if (serverInstance && serverInstance.close) {
      serverInstance.close();
    }
    await prisma.$disconnect();

    process.exit(failedCount > 0 ? 1 : 0);
  }
}

run();
