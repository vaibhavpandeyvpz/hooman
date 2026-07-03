import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getCwd } from "./cwd-context.js";
import { findGitRoot } from "./discover-files.js";
import { basePath } from "./paths.js";

const REGISTRY_FILENAME = "projects.json";
const PROJECTS_DIR = "projects";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RegistryData = { projects: Record<string, string> };

/** Container for all per-project storage: `<home>/projects`. */
export const projectsPath = () => join(basePath(), PROJECTS_DIR);

/** Path to the project id registry file: `<home>/projects.json`. */
export const projectRegistryPath = () => join(basePath(), REGISTRY_FILENAME);

/**
 * Absolute project root for a working directory. Anchored on the nearest git
 * root (falling back to the cwd when outside a repo), matching how config/mcp
 * overlays are discovered.
 */
export function currentProjectRoot(cwd: string = getCwd()): string {
  return resolve(findGitRoot(cwd));
}

let cache: RegistryData | null = null;

function normalizeData(value: unknown): RegistryData {
  if (!value || typeof value !== "object") {
    return { projects: {} };
  }
  const raw = (value as { projects?: unknown }).projects;
  if (!raw || typeof raw !== "object") {
    return { projects: {} };
  }
  const projects: Record<string, string> = {};
  for (const [key, id] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof id === "string" && UUID_RE.test(id)) {
      projects[key] = id;
    }
  }
  return { projects };
}

function loadRegistry(): RegistryData {
  if (cache) {
    return cache;
  }
  try {
    const raw = readFileSync(projectRegistryPath(), "utf8");
    cache = normalizeData(JSON.parse(raw));
  } catch {
    cache = { projects: {} };
  }
  return cache;
}

function saveRegistry(data: RegistryData): void {
  const target = projectRegistryPath();
  mkdirSync(basePath(), { recursive: true });
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, target);
  cache = data;
}

/**
 * Stable UUID for the current project, minted and persisted on first use.
 * Re-reads the on-disk registry before minting so concurrent processes reuse an
 * existing id rather than clobbering it.
 */
export function projectId(cwd: string = getCwd()): string {
  const key = currentProjectRoot(cwd);
  const existing = loadRegistry().projects[key];
  if (existing) {
    return existing;
  }

  // Re-read to reduce the window where a sibling process minted a different id.
  cache = null;
  let data = loadRegistry();
  const raced = data.projects[key];
  if (raced) {
    return raced;
  }

  const id = randomUUID();
  data = { projects: { ...data.projects, [key]: id } };
  saveRegistry(data);
  return id;
}

/** Per-project storage directory: `<home>/projects/<uuid>`. */
export function projectPath(cwd: string = getCwd()): string {
  return join(projectsPath(), projectId(cwd));
}

/** Test seam: drop the in-memory registry cache. */
export function resetProjectRegistryCache(): void {
  cache = null;
}
