import "dotenv/config";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(join(__dirname, ".."));
const PROJECT_ROOT = resolve(join(__dirname, "..", "..", ".."));
const WORKSPACE_ROOT = join(PROJECT_ROOT, "workspace");

function str(name: string, defaultValue: string): string {
  const v = process.env[name];
  return (typeof v === "string" && v.trim()) || defaultValue;
}
function num(name: string, defaultValue: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultValue;
  const n = Number(v);
  return Number.isFinite(n) ? n : defaultValue;
}

/** Loaded once at startup. Use this instead of process.env everywhere. */
export const env = {
  NODE_ENV: str("NODE_ENV", "development"),
  PORT: num("PORT", 3000),
  REDIS_URL: str("REDIS_URL", ""),
  API_BASE_URL: str("API_BASE_URL", "http://localhost:3000"),
  INTERNAL_SECRET: str("INTERNAL_SECRET", ""),
  DATABASE_URL: str("DATABASE_URL", ""),
  MCP_STDIO_DEFAULT_CWD: str(
    "MCP_STDIO_DEFAULT_CWD",
    join(WORKSPACE_ROOT, "mcpcwd"),
  ),
  SKILLS_CWD: str("SKILLS_CWD", PROJECT_ROOT),
} as const;

export { BACKEND_ROOT, PROJECT_ROOT, WORKSPACE_ROOT };

export function getDatabaseUrl(): string {
  return env.DATABASE_URL || `file:${join(WORKSPACE_ROOT, "hooman.db")}`;
}
