/**
 * Run Prisma migrations with the same DATABASE_URL logic as the app.
 * Usage: tsx scripts/db-migrate.ts
 */
import { execSync } from "child_process";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(join(__dirname, ".."));
const BACKEND_ROOT = join(PROJECT_ROOT, "apps", "backend");
const WORKSPACE_ROOT = join(PROJECT_ROOT, "workspace");

dotenv.config({ path: join(PROJECT_ROOT, ".env") });

const databaseUrl =
  process.env.DATABASE_URL?.trim() ||
  `file:${join(WORKSPACE_ROOT, "hooman.db")}`;

const schemaPath = join(BACKEND_ROOT, "prisma", "schema.prisma");

execSync(`npx prisma migrate deploy --schema=${schemaPath}`, {
  cwd: BACKEND_ROOT,
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: databaseUrl },
});
