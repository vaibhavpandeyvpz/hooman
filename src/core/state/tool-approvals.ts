import { getModeTools, isModeListedTool } from "../modes/definitions.js";
import { builtInSkillsPath } from "../skills/plugin.js";
import { getModeState } from "./session-mode.js";
import type { SessionMode } from "./session-mode.js";
import {
  isResolvedPathInsideDir,
  normalizeUserPath,
} from "../utils/normalize-user-path.js";
import { getCwd } from "../utils/cwd-context.js";
import {
  attachmentsPath,
  designArtifactsPath,
  plansPath,
} from "../utils/paths.js";
import { EXPORT_DESIGN_TOOL_NAME } from "../tools/export.js";
import {
  PREVIEW_DESIGN_TOOL_NAME,
  STOP_DESIGN_PREVIEW_TOOL_NAME,
} from "../tools/preview.js";

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
const FETCH_TOOL = "fetch";
/** Session mode switch; always requires explicit approval (never yolo / always-allow). */
export const SWITCH_MODE_TOOL = "switch_mode";
const ASK_USER_TOOL = "ask_user";
const SEARCH_TOOLS_TOOL = "search_tools";
const ACTIVATE_TOOLS_TOOL = "activate_tools";

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
  "launch_subagent",
  // Sleep
  "sleep",
  // Background shell job management (safe to use in any mode once a job exists)
  "shell_output",
  "shell_stop",
  // Asking the user a question IS the interaction — no separate approval gate.
  ASK_USER_TOOL,
  SEARCH_TOOLS_TOOL,
  ACTIVATE_TOOLS_TOOL,
  // Time
  "convert_time",
  "get_current_time",
  // Filesystem (list / search / metadata)
  "directory_tree",
  "get_file_info",
  "list_directory",
  "grep",
  // switch_mode is intentionally NOT always-allowed — see intervention.ts.
]);

const PLAN_MODE_WRITE_EDIT_TOOLS = [WRITE_FILE_TOOL, EDIT_FILE_TOOL] as const;

function toolInputPath(toolInput: unknown): string {
  if (!toolInput || typeof toolInput !== "object") {
    return "";
  }
  const path = (toolInput as { path?: unknown }).path;
  return typeof path === "string" ? path.trim() : "";
}

function toolInputSaveAs(toolInput: unknown): string {
  if (!toolInput || typeof toolInput !== "object") {
    return "";
  }
  const saveAs = (toolInput as { save_as?: unknown }).save_as;
  return typeof saveAs === "string" ? saveAs.trim() : "";
}

/**
 * In plan mode, reject `write_file` / `edit_file` unless the destination path
 * is under the plans directory, and reject `fetch` with `save_as` entirely.
 * Runs before any “always allow” grant.
 */
export function planModeWriteEditRejectionMessage(
  agent: AgentLike,
  toolName: string,
  toolInput: unknown,
): string | null {
  if (getModeState(agent).mode !== "plan") {
    return null;
  }

  if ((PLAN_MODE_WRITE_EDIT_TOOLS as readonly string[]).includes(toolName)) {
    const plansRoot = plansPath();
    const raw = toolInputPath(toolInput);
    if (raw && isResolvedPathInsideDir(normalizeUserPath(raw), plansRoot)) {
      return null;
    }
    return `In plan mode, "${toolName}" was rejected automatically: path must be under the plans directory (${plansRoot}).`;
  }

  if (toolName === FETCH_TOOL && toolInputSaveAs(toolInput)) {
    return `In plan mode, "${toolName}" with save_as was rejected automatically: downloading files is not allowed.`;
  }

  return null;
}

const DESIGN_ARTIFACT_IMPLICIT_TOOLS = [
  PREVIEW_DESIGN_TOOL_NAME,
  STOP_DESIGN_PREVIEW_TOOL_NAME,
  EXPORT_DESIGN_TOOL_NAME,
] as const;

function isDesignToolImplicitlyAllowed(
  toolName: string,
  toolInput: unknown,
): boolean {
  if (
    !(DESIGN_ARTIFACT_IMPLICIT_TOOLS as readonly string[]).includes(toolName)
  ) {
    return false;
  }
  const raw = toolInputPath(toolInput);
  return (
    Boolean(raw) &&
    isResolvedPathInsideDir(normalizeUserPath(raw), designArtifactsPath())
  );
}

/**
 * Skip approval for filesystem tools when targets stay inside trusted roots.
 * In ask/plan mode, read_file/read_multiple_files are also auto-allowed under
 * the session cwd so the narrowed surfaces can inspect the workspace without
 * repeated approval prompts. Built-in skill assets are readable in every mode.
 */
function isImplicitPathAllowed(
  toolName: string,
  toolInput: unknown,
  mode?: SessionMode,
): boolean {
  const attachments = attachmentsPath();
  const plans = plansPath();
  const readRoots = [attachments, plans, builtInSkillsPath()];
  if (mode === "ask" || mode === "plan" || mode === "design") {
    readRoots.push(getCwd());
  }

  if (toolName === READ_FILE_TOOL) {
    const raw = toolInputPath(toolInput);
    if (!raw) {
      return false;
    }
    const resolved = normalizeUserPath(raw);
    return readRoots.some((root) => isResolvedPathInsideDir(resolved, root));
  }

  if (toolName === READ_MULTIPLE_FILES_TOOL) {
    const paths =
      toolInput &&
      typeof toolInput === "object" &&
      Array.isArray((toolInput as { paths?: unknown }).paths)
        ? (toolInput as { paths: unknown[] }).paths
        : null;
    if (!paths || paths.length === 0) {
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
    const raw = toolInputPath(toolInput);
    if (!raw) {
      return false;
    }
    const resolved = normalizeUserPath(raw);
    if (isResolvedPathInsideDir(resolved, plans)) {
      return true;
    }
    // Design mode: artifact writes under `.hooman/design/` are the whole point.
    if (
      mode === "design" &&
      isResolvedPathInsideDir(resolved, designArtifactsPath())
    ) {
      return true;
    }
    return false;
  }

  return false;
}

/**
 * Implicit, always-on allow for filesystem tools whose targets stay inside
 * trusted roots: reads under attachments, plans, or bundled skills in every
 * mode, plus reads under the session cwd in ask/plan/design; writes/edits under
 * the plans directory in every mode, and under `.hooman/design/` in design mode.
 * Design tools (`preview_design`, `stop_design_preview`, `export_design`) are
 * also auto-allowed when `path` is under `.hooman/design/`. Persistent "always
 * allow" grants are handled separately by the on-disk {@link Allowlist}
 * (see `../approvals/allowlist.ts`).
 */
export function isImplicitlyAllowed(
  toolName: string,
  toolInput?: unknown,
  mode?: SessionMode,
): boolean {
  return (
    isDesignToolImplicitlyAllowed(toolName, toolInput) ||
    isImplicitPathAllowed(toolName, toolInput, mode)
  );
}

export function isToolVisible(
  mode: SessionMode,
  toolName: string,
  options?: { mcpReadOnlyHint?: boolean },
): boolean {
  const visibleTools = getModeTools(mode);
  if (!visibleTools) {
    return false;
  }
  if (visibleTools.includes(toolName)) {
    return true;
  }
  // Read-only MCP tools stay available in every mode.
  if (options?.mcpReadOnlyHint === true) {
    return true;
  }
  // Dynamic / MCP tools (not on any mode allowlist) remain available in agent.
  if (mode === "agent" && !isModeListedTool(toolName)) {
    return true;
  }
  return false;
}
