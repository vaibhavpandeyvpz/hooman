import { PrismaClient } from "@prisma/client";
import { execSync } from "child_process";
import { join } from "path";
import { getDatabaseUrl, BACKEND_ROOT } from "../../env.js";

let prisma: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({ datasourceUrl: getDatabaseUrl() });
  }
  return prisma;
}

/** Run migrations and ensure DB is ready. Call before using getPrisma() in production. */
export async function initDb(): Promise<void> {
  const schemaPath = join(BACKEND_ROOT, "prisma", "schema.prisma");
  const env = { ...process.env, DATABASE_URL: getDatabaseUrl() };
  execSync(`npx prisma migrate deploy --schema=${schemaPath}`, {
    cwd: BACKEND_ROOT,
    stdio: "inherit",
    env,
  });
  getPrisma();
}
