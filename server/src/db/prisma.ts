import { PrismaClient } from "@prisma/client";
import { config } from "../config";

const globalPrisma = global as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalPrisma.prisma ?? new PrismaClient({
  datasourceUrl: config.databaseUrl || undefined,
});

if (process.env.NODE_ENV !== "production") globalPrisma.prisma = prisma;

/**
 * Health check with automatic retry and backoff for waking Neon compute from scale-to-zero
 */
export async function checkDatabaseHealth(
  maxRetries = 3,
  delayMs = 1500
): Promise<{ ok: boolean; error?: string; latencyMs: number }> {
  const start = Date.now();
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err: any) {
      if (attempt === maxRetries) {
        return { ok: false, error: err.message, latencyMs: Date.now() - start };
      }
      // Exponential-like backoff for Neon cold start
      await new Promise((res) => setTimeout(res, delayMs * attempt));
    }
  }
  return { ok: false, error: "Database healthcheck timed out", latencyMs: Date.now() - start };
}

export default prisma;