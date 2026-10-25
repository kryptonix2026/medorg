import path from "path";
import fs from "fs";
import { spawn, execSync } from "child_process";
import { fileURLToPath } from "url";
import net from "net";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

// Helper to check if a port is in use
function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    server.once("listening", () => {
      server.close();
      resolve(false);
    });
    server.listen(port, "127.0.0.1");
  });
}

// Kill process on port
function killPort(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: "utf8" });
    const lines = out.trim().split("\n");
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && !isNaN(parseInt(pid, 10)) && parseInt(pid, 10) > 0) {
        try {
          execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
        } catch {}
      }
    }
  } catch {}
}

async function waitForHealth(url, timeoutMs = 35000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}

async function main() {
  const port5000InUse = await checkPort(5000);
  const port3000InUse = await checkPort(3000);

  if (port5000InUse) {
    console.log("⚠️  Port 5000 is already in use. Freeing port 5000...");
    killPort(5000);
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (port3000InUse) {
    console.log("⚠️  Port 3000 is already in use. Freeing port 3000...");
    killPort(3000);
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log("Starting MedOrg Development Servers (API + Client)...\n");

  const isWindows = process.platform === "win32";
  const devCmd = isWindows ? "npm.cmd run dev" : "npm run dev";

  const devProcess = spawn(devCmd, {
    cwd: rootDir,
    stdio: "inherit",
    shell: true,
  });

  const cleanup = () => {
    try {
      if (isWindows && devProcess.pid) {
        execSync(`taskkill /T /F /PID ${devProcess.pid}`, { stdio: "ignore" });
      } else {
        devProcess.kill();
      }
    } catch {}
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("exit", cleanup);

  // Poll for health directly via IPv4 to prevent dual-stack delay
  const healthy = await waitForHealth("http://127.0.0.1:5000/api/health", 35000);

  // Check config
  let aiConfigured = false;
  let brevoConfigured = false;
  let dbViewerEnabled = true;

  try {
    const statusRes = await fetch("http://127.0.0.1:5000/api/ai/status");
    if (statusRes.ok) {
      const s = await statusRes.json();
      aiConfigured = !!s.configured;
    }
  } catch {}

  const rootEnvPath = path.resolve(rootDir, ".env");
  if (fs.existsSync(rootEnvPath)) {
    const envText = fs.readFileSync(rootEnvPath, "utf8");
    brevoConfigured = envText.includes("BREVO_API_KEY=") && !envText.includes("BREVO_API_KEY=\n") && !envText.includes("BREVO_API_KEY=\"\"");
    dbViewerEnabled = !envText.includes("ENABLE_DB_VIEWER=false");
  }

  if (healthy) {
    console.log("\n==================================================");
    console.log("          MedOrg Application Started");
    console.log("==================================================");
    console.log("  App:              http://localhost:3000");
    console.log("  API Health:       http://localhost:5000/api/health");
    if (dbViewerEnabled) {
      console.log("  Database Viewer:  http://localhost:3000/#/database");
    }
    console.log(`  Brevo Email:      ${brevoConfigured ? "OK" : "Not configured"}`);
    console.log(`  Groq AI:          ${aiConfigured ? "OK" : "Not configured"}`);
    console.log("==================================================\n");

    // Open browser
    try {
      execSync('start http://localhost:3000', { stdio: "ignore" });
    } catch {}
  } else {
    console.log("\n⚠️  Server health check timed out. Please check the logs above.");
  }
}

main().catch(console.error);
