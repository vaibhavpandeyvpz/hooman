import { getModeTools } from "../modes/definitions.js";
import { getModeState } from "./session-mode.js";
import type { SessionMode } from "./session-mode.js";
import {
  isResolvedPathInsideDir,
  normalizeUserPath,
} from "../utils/normalize-user-path.js";
import { attachmentsPath, plansPath } from "../utils/paths.js";

type AppStateLike = {
  get<T = unknown>(key: string): T;
  set(key: string, value: unknown): void;
};

type AgentLike = {
  appState: AppStateLike;
};

const READ_FILE_TOOL = "read_file";
const READ_MULTIPLE_FILES_TOOL = "read_multiple_files";
const WRITE_FILE_TOOL = "write_file";
const EDIT_FILE_TOOL = "edit_file";
export const ENTER_PLAN_MODE_TOOL = "enter_plan_mode";
export const EXIT_PLAN_MODE_TOOL = "exit_plan_mode";

export const INTERNAL_ALWAYS_ALLOWED = new Set([
  // Strands / runtime
  "skills",
  "retrieve_offloaded_content",
  "search_memory",
  "strands_structured_output",
  // Todos
  "update_todos",
  // Thinking
  "think",
  // Subagents (read-only)
  "subagent_research",
  "subagent_review",
  "subagent_test_investigator",
  // Sleep
  "sleep",
  // Time
  "convert_time",
  "get_current_time",
  // Filesystem (list / search / metadata)
  "directory_tree",
  "get_file_info",
  "list_directory",
  "grep",
  // Planning session: entering is safe and auto-allowed. Exiting is a proposal
  // to leave planning and move toward implementation, so it flows through the
  // approval prompt where the user can approve or decline (and keep refining).
  ENTER_PLAN_MODE_TOOL,
]);

function isPlainObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * In session mode `plan`, block `write_file` / `edit_file` unless the target path resolves
 * under the app plans directory. Runs before any “always allow” grant so plan boundaries
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
  const readRoots = [attachments, plans];

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

/**
 * Implicit, always-on allow for filesystem tools whose targets stay inside
 * trusted app-home dirs: reads under attachments or plans, writes/edits under
 * plans. Persistent "always allow" grants are handled separately by the
 * on-disk {@link Allowlist} (see `../approvals/allowlist.ts`).
 */
export function isImplicitlyAllowed(
  toolName: string,
  toolInput?: unknown,
): boolean {
  return (
    isPlainObjectRecord(toolInput) && isImplicitPathAllowed(toolName, toolInput)
  );
}

export function isToolVisible(
  mode: SessionMode,
  toolName: string,
  options?: { mcpReadOnlyHint?: boolean },
): boolean {
  const readOnlyHinted = options?.mcpReadOnlyHint === true;
  if (mode === "agent") {
    return true;
  }
  const visibleTools = getModeTools(mode);
  if (visibleTools) {
    if (readOnlyHinted) {
      return true;
    }
    return visibleTools.includes(toolName);
  }
  return false;
}
