import { PrismaClient } from "@prisma/client";
import { getDatabaseUrl } from "../env.js";

let prisma: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({ datasourceUrl: getDatabaseUrl() });
  }
  return prisma;
}

/** Ensure the Prisma client is ready. Migrations are handled by `yarn db:migrate`. */
export async function initDb(): Promise<void> {
  getPrisma();
}
