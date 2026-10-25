import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";

export default defineConfig(() => {
  // Load root .env from parent directory directly so OS environment variables do not override it
  const rootDir = path.resolve(__dirname, "..");
  const rootEnvPath = path.resolve(rootDir, ".env");

  let apiPort = "5000";
  let viteBasePath = "/";

  if (fs.existsSync(rootEnvPath)) {
    const content = fs.readFileSync(rootEnvPath, "utf8");
    const portMatch = content.match(/^PORT\s*=\s*["']?(\d+)["']?/m);
    if (portMatch) {
      apiPort = portMatch[1];
    }
    const baseMatch = content.match(/^VITE_BASE_PATH\s*=\s*["']?([^"'\r\n]+)["']?/m);
    if (baseMatch) {
      viteBasePath = baseMatch[1].trim();
    }
  }

  return {
    base: viteBasePath,
    plugins: [react()],
    server: {
      port: 3000,
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});