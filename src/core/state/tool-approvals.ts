import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RUN_AGENTS_TOOL_NAME } from "../agents/tools.js";
import { getModeState } from "./session-mode.js";
import {
  isResolvedPathInsideDir,
  normalizeUserPath,
} from "../utils/normalize-user-path.js";
import { attachmentsPath, plansPath, skillsPath } from "../utils/paths.js";

/** Bundled `SKILL.md` tree (`dist/core/skills/built-in` or `src/...` under tsx). */
const BUILTIN_SKILLS_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../skills/built-in",
);

type AppStateLike = {
  get<T = unknown>(key: string): T;
  set(key: string, value: unknown): void;
};

type AgentLike = {
  appState: AppStateLike;
};

const SESSION_ALLOWED_TOOLS_KEY = "allowedTools";

const READ_FILE_TOOL = "read_file";
const READ_MULTIPLE_FILES_TOOL = "read_multiple_files";
const WRITE_FILE_TOOL = "write_file";
const EDIT_FILE_TOOL = "edit_file";
export const ENTER_PLAN_MODE_TOOL = "enter_plan_mode";
export const EXIT_PLAN_MODE_TOOL = "exit_plan_mode";

export const INTERNAL_ALWAYS_ALLOWED = new Set([
  // Strands / runtime
  "strands_structured_output",
  // Todos
  "update_todos",
  // Thinking
  "think",
  // Agent orchestration
  RUN_AGENTS_TOOL_NAME,
  // Sleep
  "sleep",
  // Process lifecycle
  "bye",
  // Time
  "convert_time",
  "get_current_time",
  // Wiki
  "wiki_knowledge_graph",
  "wiki_list_files",
  "wiki_read_file",
  "wiki_search",
  "wiki_stats",
  "wiki_write_file",
  // Long-term memory
  "memory_archive",
  "memory_search",
  "memory_store",
  "memory_update",
  // Filesystem (list / search / metadata)
  "directory_tree",
  "get_file_info",
  "list_directory",
  "search_files",
  // Planning session (mode / plan file)
  ENTER_PLAN_MODE_TOOL,
  EXIT_PLAN_MODE_TOOL,
]);

export const PLAN_MODE_ALWAYS_ALLOWED = new Set([
  "read_file",
  "read_multiple_files",
  "fetch",
  "web_search",
]);

export const PLAN_MODE_VISIBLE = new Set([
  // Internet
  "fetch",
  "web_search",
  // Strands / runtime
  "strands_structured_output",
  // Todos
  "update_todos",
  // Thinking
  "think",
  // Agent orchestration
  RUN_AGENTS_TOOL_NAME,
  // Sleep
  "sleep",
  // Process lifecycle
  "bye",
  // Time
  "convert_time",
  "get_current_time",
  // Wiki
  "wiki_knowledge_graph",
  "wiki_list_files",
  "wiki_read_file",
  "wiki_search",
  "wiki_stats",
  "wiki_write_file",
  // Long-term memory
  "memory_search",
  // Filesystem (list / search / metadata)
  "directory_tree",
  "get_file_info",
  "list_directory",
  "search_files",
  "read_file",
  "read_multiple_files",
  "write_file",
  "edit_file",
  // Planning session (mode / plan file)
  ENTER_PLAN_MODE_TOOL,
  EXIT_PLAN_MODE_TOOL,
]);

/** Same narrowed surface as plan mode but without plan lifecycle tools. */
export const ASK_MODE_VISIBLE = new Set(
  [...PLAN_MODE_VISIBLE].filter(
    (name) => name !== ENTER_PLAN_MODE_TOOL && name !== EXIT_PLAN_MODE_TOOL,
  ),
);

function isPlainObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * In session mode `plan`, block `write_file` / `edit_file` unless the target path resolves
 * under the app plans directory. Runs before session-wide “always allow” so plan boundaries
 * cannot be overridden by tooling preferences.
 */
export function planModeWriteEditRejectionMessage(
  agent: AgentLike,
  toolName: string,
  toolInput: unknown,
): string | null {
  if (getModeState(agent).mode !== "plan") {
    return null;
  }
  if (toolName !== WRITE_FILE_TOOL && toolName !== EDIT_FILE_TOOL) {
    return null;
  }
  const plansRoot = plansPath();
  if (!isPlainObjectRecord(toolInput)) {
    return `In plan mode, "${toolName}" only applies to files under the plans directory (${plansRoot}).`;
  }
  const raw = toolInput.path;
  if (typeof raw !== "string" || !raw.trim()) {
    return `In plan mode, "${toolName}" requires a path under the plans directory (${plansRoot}).`;
  }
  const resolved = normalizeUserPath(raw.trim());
  if (isResolvedPathInsideDir(resolved, plansRoot)) {
    return null;
  }
  return `In plan mode, "${toolName}" was rejected automatically: path must be under the plans directory (${plansRoot}).`;
}

/** Skip approval for filesystem tools when targets stay inside trusted app-home dirs. */
function isImplicitPathAllowed(
  toolName: string,
  toolInput: Record<string, unknown>,
): boolean {
  const attachments = attachmentsPath();
  const plans = plansPath();
  const skills = skillsPath();
  const readRoots = [attachments, plans, skills, BUILTIN_SKILLS_ROOT];

  if (toolName === READ_FILE_TOOL) {
    const raw = toolInput.path;
    if (typeof raw !== "string" || !raw.trim()) {
      return false;
    }
    const resolved = normalizeUserPath(raw);
    return readRoots.some((root) => isResolvedPathInsideDir(resolved, root));
  }

  if (toolName === READ_MULTIPLE_FILES_TOOL) {
    const paths = toolInput.paths;
    if (!Array.isArray(paths) || paths.length === 0) {
      return false;
    }
    for (const item of paths) {
      if (typeof item !== "string" || !item.trim()) {
        return false;
      }
      const resolved = normalizeUserPath(item);
      const ok = readRoots.some((root) =>
        isResolvedPathInsideDir(resolved, root),
      );
      if (!ok) {
        return false;
      }
    }
    return true;
  }

  if (toolName === WRITE_FILE_TOOL || toolName === EDIT_FILE_TOOL) {
    const raw = toolInput.path;
    if (typeof raw !== "string" || !raw.trim()) {
      return false;
    }
    const resolved = normalizeUserPath(raw);
    return isResolvedPathInsideDir(resolved, plans);
  }

  return false;
}

function normalizeAllowedTools(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const normalized = entry.trim();
    if (!normalized) {
      continue;
    }
    unique.add(normalized);
  }
  return [...unique];
}

export function getSessionAllowedTools(agent: AgentLike): string[] {
  const current = normalizeAllowedTools(
    agent.appState.get(SESSION_ALLOWED_TOOLS_KEY),
  );
  const raw = agent.appState.get(SESSION_ALLOWED_TOOLS_KEY);
  if (!Array.isArray(raw) || current.length !== raw.length) {
    agent.appState.set(SESSION_ALLOWED_TOOLS_KEY, current);
  }
  return current;
}

/**
 * Session-wide tool allowlist ("always allow" in UI), plus implicit allow for
 * read/write/edit when paths resolve under attachments, plans, skills (reads),
 * shipped built-in skill files under `core/skills/built-in` (reads), or plans
 * only (writes/edits).
 */
export function isToolSessionAllowed(
  agent: AgentLike,
  toolName: string,
  toolInput?: unknown,
): boolean {
  const mode = getModeState(agent).mode;
  if (getSessionAllowedTools(agent).includes(toolName)) {
    return true;
  }
  if (
    (mode === "plan" || mode === "ask") &&
    PLAN_MODE_ALWAYS_ALLOWED.has(toolName)
  ) {
    return true;
  }
  if (
    isPlainObjectRecord(toolInput) &&
    isImplicitPathAllowed(toolName, toolInput)
  ) {
    return true;
  }
  return false;
}

export function isToolVisible(
  mode: string,
  toolName: string,
  options?: { mcpReadOnlyHint?: boolean },
): boolean {
  const readOnlyHinted = options?.mcpReadOnlyHint === true;
  if (mode === "default") {
    return true;
  }
  if (mode === "plan") {
    if (readOnlyHinted) {
      return true;
    }
    return PLAN_MODE_VISIBLE.has(toolName);
  }
  if (mode === "ask") {
    if (readOnlyHinted) {
      return true;
    }
    return ASK_MODE_VISIBLE.has(toolName);
  }
  return false;
}

export function allowToolForSession(agent: AgentLike, toolName: string): void {
  const normalized = toolName.trim();
  if (!normalized) {
    return;
  }
  const allowed = getSessionAllowedTools(agent);
  if (allowed.includes(normalized)) {
    return;
  }
  agent.appState.set(SESSION_ALLOWED_TOOLS_KEY, [...allowed, normalized]);
}
