import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const schemaPath = path.resolve(rootDir, "prisma", "schema.prisma");

const target = (process.argv[2] || "").toLowerCase();

if (target !== "sqlite" && target !== "postgres" && target !== "postgresql") {
  console.error("Usage: tsx scripts/useDb.ts <sqlite|postgres>");
  process.exit(1);
}

const isPostgres = target === "postgres" || target === "postgresql";

let schemaContent = fs.readFileSync(schemaPath, "utf8");

const sqliteDatasource = `datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}`;

const postgresDatasource = `datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}`;

const datasourceRegex = /datasource\s+db\s*\{[\s\S]*?\}/;

if (!datasourceRegex.test(schemaContent)) {
  console.error("Could not find datasource block in schema.prisma");
  process.exit(1);
}

schemaContent = schemaContent.replace(
  datasourceRegex,
  isPostgres ? postgresDatasource : sqliteDatasource
);

fs.writeFileSync(schemaPath, schemaContent, "utf8");
console.log(`[useDb] Set schema datasource provider to ${isPostgres ? "postgresql" : "sqlite"}`);

try {
  console.log("[useDb] Regenerating Prisma Client...");
  execSync("npx prisma generate --schema=prisma/schema.prisma", {
    cwd: rootDir,
    stdio: "inherit",
  });
  console.log(`[useDb] Successfully switched database provider to ${isPostgres ? "PostgreSQL" : "SQLite"}`);
} catch (err: any) {
  console.error("[useDb] Failed to regenerate Prisma client:", err.message);
  process.exit(1);
}
