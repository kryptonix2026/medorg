import dotenv from "dotenv";
dotenv.config({ override: true });

import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import prisma from "../server/src/db/prisma";
import { config } from "../server/src/config";
import { aiStatus, summarizeHistory } from "../server/src/ai";
import aiRoutes from "../server/src/routes/ai";
import { requireAuth } from "../server/src/middleware/auth";

// Resolve express from server package dependencies
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRequire = createRequire(path.resolve(__dirname, "../server/package.json"));
const express = serverRequire("express");

async function runVerification() {
  console.log("=== MedOrg AI Provider Verification ===\n");

  const originalKey = config.groqApiKey;
  const originalBaseUrl = config.groqBaseUrl;
  const originalModel = config.groqModel;

  let server: any = null;
  let mockServer: http.Server | null = null;
  let aishaTokenHash: string | null = null;
  let rafaelTokenHash: string | null = null;

  try {
    // 1. Check config defaults
    console.log("Test 1: Config inspection");
    console.log("GROQ_BASE_URL:", config.groqBaseUrl);
    console.log("GROQ_MODEL:", config.groqModel);
    console.log("GROQ_API_KEY present:", !!config.groqApiKey);
    if (config.groqBaseUrl !== "https://api.groq.com/openai/v1") {
      throw new Error(`GROQ_BASE_URL default mismatch: expected https://api.groq.com/openai/v1, got ${config.groqBaseUrl}`);
    }
    if (config.groqModel !== "openai/gpt-oss-20b") {
      throw new Error(`GROQ_MODEL default mismatch: expected openai/gpt-oss-20b, got ${config.groqModel}`);
    }
    console.log("✓ Config defaults verified\n");

    // 2. Test aiStatus() when no key is set
    console.log("Test 2: aiStatus() without API key");
    config.groqApiKey = "";
    const statusNoKey = aiStatus();
    console.log("Status without key:", statusNoKey);
    if (statusNoKey.configured !== false || statusNoKey.model !== "openai/gpt-oss-20b") {
      throw new Error("aiStatus without key failed");
    }
    console.log("✓ aiStatus reports configured: false, model: openai/gpt-oss-20b\n");

    // 3. Test summarizeHistory() error when no key is set
    console.log("Test 3: summarizeHistory() without API key");
    try {
      await summarizeHistory("Test Patient", []);
      throw new Error("Should have thrown error when key is absent");
    } catch (err: any) {
      if (err.message !== "AI is not configured") {
        throw new Error(`Unexpected error message: ${err.message}`);
      }
      console.log("✓ Correctly threw 'AI is not configured'\n");
    }

    // 4. Test Express App endpoints
    console.log("Test 4: Express API routes");
    const app = express();
    app.use(express.json());
    app.get("/api/health", (req: any, res: any) => res.json({ status: "ok" }));
    app.use("/api/ai", requireAuth, aiRoutes);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const address = server.address() as any;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    // Health check
    const healthRes = await fetch(`${baseUrl}/api/health`);
    const healthJson = await healthRes.json();
    console.log("/api/health response:", healthJson);
    if (healthJson.status !== "ok") throw new Error("Health check failed");
    console.log("✓ /api/health is ok\n");

    // Retrieve seeded doctors and patients
    const aisha = await prisma.doctor.findFirst({ where: { doctorId: "DOC-0001" } });
    const rafael = await prisma.doctor.findFirst({ where: { doctorId: "DOC-0002" } });
    const meera = await prisma.user.findFirst({ where: { medOrgId: "MED-000001" } });
    const thomas = await prisma.user.findFirst({ where: { medOrgId: "MED-000002" } });

    if (!aisha || !rafael || !meera || !thomas) {
      throw new Error("Seeded users not found in database. Run `npm run db:seed` first.");
    }

    // Create session tokens for testing
    const aishaToken = "test-token-aisha-" + Date.now();
    aishaTokenHash = crypto.createHash("sha256").update(aishaToken).digest("hex");
    await prisma.session.create({
      data: {
        userType: "DOCTOR",
        userId: aisha.id,
        tokenHash: aishaTokenHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    const rafaelToken = "test-token-rafael-" + Date.now();
    rafaelTokenHash = crypto.createHash("sha256").update(rafaelToken).digest("hex");
    await prisma.session.create({
      data: {
        userType: "DOCTOR",
        userId: rafael.id,
        tokenHash: rafaelTokenHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    // Test 5: GET /api/ai/status endpoint
    console.log("Test 5: GET /api/ai/status endpoint");
    const statusRes = await fetch(`${baseUrl}/api/ai/status`, {
      headers: { Authorization: `Bearer ${aishaToken}` },
    });
    const statusData = await statusRes.json();
    console.log("GET /api/ai/status response:", statusData);
    if (statusData.configured !== false || !statusData.modelConfigured || statusData.model !== "openai/gpt-oss-20b") {
      throw new Error("GET /api/ai/status response unexpected");
    }
    const responseKeys = Object.keys(statusData);
    if (responseKeys.some((k) => k.toLowerCase().includes("key") || k.toLowerCase().includes("secret"))) {
      throw new Error("Secret key property leaked in status response!");
    }
    console.log("✓ GET /api/ai/status reports unconfigured with model name and never leaks key\n");

    // Test 6: Unauthorized doctor (Rafael) accessing Meera records
    console.log("Test 6: Unauthorized doctor accessing /api/ai/summarize");
    const unauthRes = await fetch(`${baseUrl}/api/ai/summarize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${rafaelToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ patientId: meera.id }),
    });
    const unauthJson: any = await unauthRes.json();
    console.log(`Unauthorized doctor status: ${unauthRes.status}, body:`, unauthJson);
    if (unauthRes.status !== 403 || unauthJson.error !== "Patient access authorization is required") {
      throw new Error(`Expected 403 'Patient access authorization is required', got ${unauthRes.status}: ${JSON.stringify(unauthJson)}`);
    }
    console.log("✓ Unauthorized doctor receives 403 'Patient access authorization is required'\n");

    // Test 7: Doctor Aisha accessing Thomas (status: DENIED)
    console.log("Test 7: Doctor accessing patient with DENIED status");
    const deniedRes = await fetch(`${baseUrl}/api/ai/summarize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aishaToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ patientId: thomas.id }),
    });
    const deniedJson: any = await deniedRes.json();
    console.log(`Denied access status: ${deniedRes.status}, body:`, deniedJson);
    if (deniedRes.status !== 403 || deniedJson.error !== "Patient access authorization is required") {
      throw new Error(`Expected 403 'Patient access authorization is required' for denied access, got ${deniedRes.status}`);
    }
    console.log("✓ Denied access receives 403 'Patient access authorization is required'\n");

    // Test 8: Authorized doctor (Aisha) with NO GROQ_API_KEY
    console.log("Test 8: Authorized doctor calling /api/ai/summarize with no GROQ_API_KEY");
    const noKeySummarizeRes = await fetch(`${baseUrl}/api/ai/summarize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aishaToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ patientId: meera.id }),
    });
    const noKeyJson: any = await noKeySummarizeRes.json();
    console.log(`No key summarize status: ${noKeySummarizeRes.status}, body:`, noKeyJson);
    if (noKeySummarizeRes.status !== 500 || noKeyJson.error !== "AI is not configured") {
      throw new Error(`Expected 500 'AI is not configured', got ${noKeySummarizeRes.status}: ${JSON.stringify(noKeyJson)}`);
    }
    console.log("✓ Correctly returns 500 'AI is not configured'\n");

    // Test 9: Test Groq payload structure, headers, and error mapping with a mock Groq HTTP server
    console.log("Test 9: Groq API call contract verification");
    let receivedPayload: any = null;
    let receivedAuthHeader: string | null = null;
    let serverMode: "success" | "auth_error" | "500_error" | "empty_content" = "success";

    mockServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        receivedAuthHeader = req.headers.authorization || null;
        try {
          receivedPayload = body ? JSON.parse(body) : null;
        } catch {
          receivedPayload = null;
        }

        if (serverMode === "auth_error") {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "Invalid API Key" } }));
          return;
        }

        if (serverMode === "500_error") {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "Internal Server Error" } }));
          return;
        }

        if (serverMode === "empty_content") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: "",
                    reasoning: "Thinking about records...",
                  },
                },
              ],
            })
          );
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: "chatcmpl-test",
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "Summary generated from the on-file records.\n\nPatient Meera Raghavan has 2 medical reports on file.",
                  reasoning: "Internal reasoning tokens count against cap...",
                },
                finish_reason: "stop",
              },
            ],
          })
        );
      });
    });

    await new Promise<void>((resolve) => {
      mockServer!.listen(0, () => resolve());
    });
    const mockAddress = mockServer.address() as any;
    const mockBaseUrl = `http://127.0.0.1:${mockAddress.port}`;

    // Configure Groq with mock URL and test key
    config.groqBaseUrl = mockBaseUrl;
    config.groqApiKey = "gsk_test_mock_key_123456789";
    config.groqModel = "openai/gpt-oss-20b";

    // Call summarize with valid key and mock Groq server
    serverMode = "success";
    const summarizeRes = await fetch(`${baseUrl}/api/ai/summarize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aishaToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ patientId: meera.id }),
    });
    const summarizeJson: any = await summarizeRes.json();
    console.log("Summarize response:", summarizeJson);

    if (!summarizeJson.success || !summarizeJson.summary) {
      throw new Error("Summarize failed on mock server");
    }
    if (!summarizeJson.summary.startsWith("Summary generated from the on-file records.")) {
      throw new Error("Summary missing required opening line");
    }
    console.log("✓ Summary generated and begins with required opening line");

    // Check payload sent to Groq
    if (receivedAuthHeader !== "Bearer gsk_test_mock_key_123456789") {
      throw new Error(`Incorrect Authorization header: ${receivedAuthHeader}`);
    }
    if (receivedPayload?.model !== "openai/gpt-oss-20b") {
      throw new Error(`Incorrect model in payload: ${receivedPayload?.model}`);
    }
    if (receivedPayload?.max_completion_tokens !== 1500) {
      throw new Error(`Incorrect max_completion_tokens: ${receivedPayload?.max_completion_tokens}`);
    }
    if (receivedPayload?.reasoning_effort !== "low") {
      throw new Error(`Incorrect reasoning_effort: ${receivedPayload?.reasoning_effort}`);
    }
    if (receivedPayload?.temperature > 0.3) {
      throw new Error(`Temperature too high: ${receivedPayload?.temperature}`);
    }
    if (summarizeJson.summary.includes("Internal reasoning tokens")) {
      throw new Error("Reasoning field leaked into client response!");
    }
    if (JSON.stringify(summarizeJson).includes("gsk_test_mock_key_123456789")) {
      throw new Error("API key leaked in response!");
    }
    console.log("✓ Verified Groq payload parameters (max_completion_tokens: 1500, reasoning_effort: low, temperature <= 0.3)");
    console.log("✓ Verified reasoning field is NOT in summary or response");
    console.log("✓ Verified API key is NOT in response\n");

    // Test 10: 401 error mapping -> "Groq API key was rejected"
    console.log("Test 10: Error mapping for 401");
    serverMode = "auth_error";
    const authErrRes = await fetch(`${baseUrl}/api/ai/summarize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aishaToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ patientId: meera.id }),
    });
    const authErrJson: any = await authErrRes.json();
    console.log("Auth error response:", authErrJson);
    if (authErrJson.error !== "Groq API key was rejected") {
      throw new Error(`Expected 'Groq API key was rejected', got ${authErrJson.error}`);
    }
    console.log("✓ 401 correctly mapped to 'Groq API key was rejected'\n");

    // Test 11: 500 error mapping -> "The AI service is temporarily unavailable, please try again"
    console.log("Test 11: Error mapping for 500");
    serverMode = "500_error";
    const serverErrRes = await fetch(`${baseUrl}/api/ai/summarize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aishaToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ patientId: meera.id }),
    });
    const serverErrJson: any = await serverErrRes.json();
    console.log("500 error response:", serverErrJson);
    if (serverErrJson.error !== "The AI service is temporarily unavailable, please try again") {
      throw new Error(`Expected 'The AI service is temporarily unavailable, please try again', got ${serverErrJson.error}`);
    }
    console.log("✓ 500 correctly mapped to 'The AI service is temporarily unavailable, please try again'\n");

    // Test 12: Empty content (e.g. reasoning exhausted tokens) -> "The AI service is temporarily unavailable, please try again"
    console.log("Test 12: Empty content error handling");
    serverMode = "empty_content";
    const emptyErrRes = await fetch(`${baseUrl}/api/ai/summarize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aishaToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ patientId: meera.id }),
    });
    const emptyErrJson: any = await emptyErrRes.json();
    console.log("Empty content error response:", emptyErrJson);
    if (emptyErrJson.error !== "The AI service is temporarily unavailable, please try again") {
      throw new Error(`Expected 'The AI service is temporarily unavailable, please try again', got ${emptyErrJson.error}`);
    }
    console.log("✓ Empty content handled as temporary-unavailable error\n");
  } finally {
    if (server) {
      server.close();
    }
    if (mockServer) {
      mockServer.close();
    }
    if (aishaTokenHash || rafaelTokenHash) {
      const hashes = [aishaTokenHash, rafaelTokenHash].filter(Boolean) as string[];
      await prisma.session.deleteMany({
        where: { tokenHash: { in: hashes } },
      });
    }
    await prisma.$disconnect();

    // Restore original config
    config.groqBaseUrl = originalBaseUrl;
    config.groqApiKey = originalKey;
    config.groqModel = originalModel;
  }

  console.log("🎉 ALL VERIFICATION TESTS PASSED SUCCESSFULLY! 🎉\n");
}

runVerification().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
