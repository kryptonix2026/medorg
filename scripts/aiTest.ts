import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const rootEnvPath = path.resolve(rootDir, ".env");

if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath, override: true });
} else {
  dotenv.config({ override: true });
}

import { config } from "../server/src/config";

async function main() {
  console.log("==================================================");
  console.log("           MedOrg Groq AI Diagnostic Test");
  console.log("==================================================\n");

  console.log(`Provider:  Groq`);
  console.log(`Base URL:  ${config.groqBaseUrl}`);
  console.log(`Model:     ${config.groqModel}`);
  console.log(`API Key:   ${config.groqApiKey ? "Present (configured)" : "NOT CONFIGURED"}\n`);

  if (!config.groqApiKey) {
    console.log("--------------------------------------------------");
    console.log("HTTP Status:     N/A");
    console.log("Error Category:  auth");
    console.log("Details:         GROQ_API_KEY is missing. Set GROQ_API_KEY in the root .env file and rerun.");
    console.log("--------------------------------------------------\n");
    process.exit(0);
  }

  // 1. Fetch available models (IDs only)
  console.log("Querying GET /models for available model IDs...");
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const modelsRes = await fetch(`${config.groqBaseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${config.groqApiKey}`,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (modelsRes.ok) {
      const data: any = await modelsRes.json();
      const modelIds = Array.isArray(data.data) ? data.data.map((m: any) => m.id) : [];
      console.log(`✓ Models retrieved (${modelIds.length} available):`);
      console.log(`  ${modelIds.slice(0, 10).join(", ")}${modelIds.length > 10 ? "..." : ""}\n`);
    } else {
      console.log(`⚠️  GET /models returned status ${modelsRes.status}\n`);
    }
  } catch (err: any) {
    console.log(`⚠️  Could not retrieve models list: ${err.message}\n`);
  }

  // 2. Send one tiny completion test
  console.log(`Sending test completion to model "${config.groqModel}"...`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  let httpStatus = 0;
  let category: "auth" | "model-not-found" | "rate-limit" | "timeout" | "empty-output" | "other" | "none" = "other";
  let first200Chars = "";

  try {
    const res = await fetch(`${config.groqBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.groqModel || "openai/gpt-oss-20b",
        messages: [{ role: "user", content: "Respond with one short sentence acknowledging this test." }],
        max_completion_tokens: 1500,
        temperature: 0.2,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    httpStatus = res.status;

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) category = "auth";
      else if (res.status === 404) category = "model-not-found";
      else if (res.status === 429) category = "rate-limit";
      else category = "other";

      const errText = await res.text();
      first200Chars = errText.substring(0, 200);
    } else {
      const data: any = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text || typeof text !== "string" || text.trim().length === 0) {
        category = "empty-output";
        first200Chars = "(empty response content)";
      } else {
        category = "none";
        first200Chars = text.trim().substring(0, 200);
      }
    }
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === "AbortError" || err.message?.includes("timeout")) {
      category = "timeout";
      first200Chars = "Request timed out after 20 seconds";
    } else {
      category = "other";
      first200Chars = err.message || "Network error";
    }
  }

  console.log("--------------------------------------------------");
  console.log(`HTTP Status:     ${httpStatus || "Network failure"}`);
  console.log(`Error Category:  ${category}`);
  console.log(`First 200 Chars: ${first200Chars}`);
  console.log("--------------------------------------------------\n");

  if (category === "none") {
    console.log("✓ Groq AI completion test PASSED successfully!\n");
  } else {
    console.log(`⚠️  Groq AI test returned category: ${category}\n`);
  }
}

main().catch(console.error);
