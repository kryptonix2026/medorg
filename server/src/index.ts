import express from "express";
import helmet from "helmet";
import cors from "cors";
import { config } from "./config";
import patientAuthRoutes from "./routes/patientAuth";
import doctorAuthRoutes from "./routes/doctorAuth";
import accessRoutes from "./routes/access";
import patientRoutes from "./routes/patients";
import recordRoutes from "./routes/records";
import aiRoutes from "./routes/ai";
import notificationRoutes from "./routes/notification";
import liveRoutes from "./routes/live";
import databaseRoutes from "./routes/database";
import globalErrorHandler from "./middleware/globalErrorHandler";
import { limiter } from "./middleware/rateLimiter";
import { requireAuth } from "./middleware/auth";
import { getDevOtp } from "./utils/devOtp";

const app = express();

app.use(helmet());
app.use(cors({ origin: config.allowedOrigins, credentials: true }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
app.use("/api", limiter);

import { checkDatabaseHealth } from "./db/prisma";

// Health check: Light, DB-free check for Render / load-balancer probes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Database health check: actively verifies database connection with cold-start retry
app.get("/api/health/db", async (req, res) => {
  const health = await checkDatabaseHealth();
  if (health.ok) {
    res.json({
      status: "ok",
      database: "connected",
      latencyMs: health.latencyMs,
      dbMode: config.dbMode,
      neonBranch: config.neonBranch || undefined,
    });
  } else {
    res.status(503).json({
      status: "error",
      database: "unreachable",
      error: health.error,
      latencyMs: health.latencyMs,
    });
  }
});

// Auth routes (no requireAuth - they handle auth themselves)
app.use("/api/auth/patient", patientAuthRoutes);
app.use("/api/auth/doctor", doctorAuthRoutes);

// Dev-only OTP capture endpoint: enabled ONLY in development/test with OTP_DEV_LOG=true, never in production
if (config.nodeEnv !== "production" && config.otpDevLog) {
  app.get("/api/auth/dev-otp", (req, res) => {
    const email = String(req.query.email || "").trim().toLowerCase();
    const otp = getDevOtp(email);
    if (!otp) {
      return res.status(404).json({ error: "No dev OTP recorded for email" });
    }
    res.json({ email, otp });
  });
}

// Access control routes (requireAuth)
app.use("/api/access", requireAuth, accessRoutes);

// Patient & records routes (requireAuth)
app.use("/api/patients", requireAuth, patientRoutes);
app.use("/api/records", requireAuth, recordRoutes);

// AI routes (status is public, /summarize protected by requirePatientAccess)
app.use("/api/ai", aiRoutes);

// Notification routes (requireAuth)
app.use("/api/notifications", requireAuth, notificationRoutes);

// Live status routes (requireAuth)
app.use("/api/live", requireAuth, liveRoutes);

// Database viewer routes (gated by ENABLE_DB_VIEWER)
app.use("/api/database", databaseRoutes);

// 404 handler for unmatched routes
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Global error handler
app.use(globalErrorHandler);

const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`MedOrg server running on port ${config.port} [${config.nodeEnv}]`);
});

export default server;