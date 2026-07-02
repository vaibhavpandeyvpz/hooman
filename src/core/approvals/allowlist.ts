import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { allowlistJsonPath } from "../utils/paths.js";
import { normalizeUserPath } from "../utils/normalize-user-path.js";
import { arityPrefix, splitCommands, tokenize } from "./bash-arity.js";
import { matchWildcard } from "./wildcard.js";

/** Sentinel resource/pattern meaning "the whole tool" (no argument dimension). */
const TOOL_WIDE = "*";

const SHELL_TOOL = "shell";

/**
 * Input keys that carry filesystem paths, per tool. When present, "always
 * allow" is scoped to those exact paths instead of the whole tool.
 */
const PATH_TOOL_KEYS: Record<string, readonly string[]> = {
  read_file: ["path"],
  read_multiple_files: ["paths"],
  write_file: ["path"],
  edit_file: ["path"],
  create_directory: ["path"],
  move_file: ["source", "destination"],
  get_file_info: ["path"],
};

/** A single persisted allow rule: a tool name plus an argument pattern. */
export type AllowlistRule = { tool: string; pattern: string };

export type AllowlistOptions = {
  /** Override the on-disk location (defaults to `~/.hooman/allowlist.json`). */
  filePath?: string;
};

type ResourceKind = "command" | "path" | "generic";

type Resources = { kind: ResourceKind; values: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Pull the raw command strings out of the shell tool's flexible input. */
function extractShellCommands(input: unknown): string[] {
  if (!isRecord(input)) {
    return [];
  }
  const raw = input.command;
  const entries = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const entry of entries) {
    if (typeof entry === "string") {
      if (entry.trim()) {
        out.push(entry.trim());
      }
    } else if (
      isRecord(entry) &&
      typeof entry.command === "string" &&
      entry.command.trim()
    ) {
      out.push(entry.command.trim());
    }
  }
  return out;
}

/** Resolve the filesystem path(s) referenced by a path-bearing tool. */
function extractPaths(tool: string, input: unknown): string[] | null {
  const keys = PATH_TOOL_KEYS[tool];
  if (!keys) {
    return null;
  }
  if (!isRecord(input)) {
    return [];
  }
  const paths: string[] = [];
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      paths.push(normalizeUserPath(value));
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.trim()) {
          paths.push(normalizeUserPath(item));
        }
      }
    }
  }
  return paths;
}

/**
 * Reduce a tool call to the resource strings that a rule must match. Shell
 * calls yield one string per sub-command; path tools yield resolved paths;
 * everything else is treated as tool-wide.
 */
function deriveResources(tool: string, input: unknown): Resources {
  if (tool === SHELL_TOOL) {
    const segments = extractShellCommands(input).flatMap(splitCommands);
    return {
      kind: "command",
      values: segments.length > 0 ? segments : [TOOL_WIDE],
    };
  }

  const paths = extractPaths(tool, input);
  if (paths) {
    return { kind: "path", values: paths.length > 0 ? paths : [TOOL_WIDE] };
  }

  return { kind: "generic", values: [TOOL_WIDE] };
}

/**
 * Given a tool call, propose the reusable patterns that "always allow" should
 * persist. Shell commands are broadened via {@link arityPrefix} (`git log *`);
 * path tools keep the exact resolved path; other tools become tool-wide.
 */
function deriveProposals(tool: string, input: unknown): string[] {
  const { kind, values } = deriveResources(tool, input);

  if (kind === "command") {
    const patterns = new Set<string>();
    for (const segment of values) {
      if (segment === TOOL_WIDE) {
        patterns.add(TOOL_WIDE);
        continue;
      }
      const prefix = arityPrefix(tokenize(segment));
      patterns.add(prefix.length > 0 ? `${prefix.join(" ")} *` : TOOL_WIDE);
    }
    return [...patterns];
  }

  if (kind === "path") {
    return [...new Set(values)];
  }

  return [TOOL_WIDE];
}

/**
 * Disk-backed, pattern-based allowlist for "always allow" tool approvals.
 *
 * Rules are keyed by tool name and matched against an argument-derived
 * resource string using {@link matchWildcard}. The design follows the
 * opencode/kilocode/Claude Code permission engines: shell commands match on a
 * (broadened) command prefix, filesystem tools match on resolved paths, and
 * argument-less tools are stored tool-wide (`*`).
 */
export class Allowlist {
  private readonly filePath: string;
  /** tool name -> set of allowed argument patterns */
  private readonly store = new Map<string, Set<string>>();

  public constructor(options?: AllowlistOptions) {
    this.filePath = options?.filePath ?? allowlistJsonPath();
    this.load();
  }

  /** Whether a tool call is already covered by a persisted allow rule. */
  public isAllowed(tool: string, input?: unknown): boolean {
    const patterns = this.store.get(tool);
    if (!patterns || patterns.size === 0) {
      return false;
    }
    const { values } = deriveResources(tool, input);
    return values.every((resource) =>
      [...patterns].some((pattern) => matchWildcard(resource, pattern)),
    );
  }

  /**
   * Preview the patterns that {@link allowAlways} would persist for a tool
   * call, without writing anything. Useful for showing the user what "always
   * allow" will grant.
   */
  public proposals(tool: string, input?: unknown): string[] {
    return deriveProposals(tool, input);
  }

  /**
   * Persist "always allow" for a tool call. Returns the patterns that were
   * newly added (already-present patterns are skipped).
   */
  public allowAlways(tool: string, input?: unknown): string[] {
    const added: string[] = [];
    for (const pattern of deriveProposals(tool, input)) {
      if (this.addPattern(tool, pattern)) {
        added.push(pattern);
      }
    }
    if (added.length > 0) {
      this.persist();
    }
    return added;
  }

  /** Add an explicit rule. Returns true if it was not already present. */
  public addRule(tool: string, pattern: string): boolean {
    const added = this.addPattern(tool, pattern);
    if (added) {
      this.persist();
    }
    return added;
  }

  /** Remove an explicit rule. Returns true if it existed. */
  public removeRule(tool: string, pattern: string): boolean {
    const patterns = this.store.get(tool);
    if (!patterns?.delete(pattern.trim())) {
      return false;
    }
    if (patterns.size === 0) {
      this.store.delete(tool);
    }
    this.persist();
    return true;
  }

  /** All persisted rules, flattened. */
  public rules(): AllowlistRule[] {
    const rules: AllowlistRule[] = [];
    for (const [tool, patterns] of this.store) {
      for (const pattern of patterns) {
        rules.push({ tool, pattern });
      }
    }
    return rules;
  }

  /** Remove every rule and persist the empty allowlist. */
  public clear(): void {
    this.store.clear();
    this.persist();
  }

  /** Re-read the allowlist from disk, discarding in-memory state. */
  public reload(): void {
    this.load();
  }

  private addPattern(tool: string, pattern: string): boolean {
    const toolName = tool.trim();
    const normalized = pattern.trim();
    if (!toolName || !normalized) {
      return false;
    }
    let patterns = this.store.get(toolName);
    if (!patterns) {
      patterns = new Set<string>();
      this.store.set(toolName, patterns);
    }
    if (patterns.has(normalized)) {
      return false;
    }
    patterns.add(normalized);
    return true;
  }

  private load(): void {
    this.store.clear();
    if (!existsSync(this.filePath)) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch {
      return;
    }
    if (!isRecord(parsed)) {
      return;
    }
    for (const [tool, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) {
        continue;
      }
      for (const pattern of value) {
        if (typeof pattern === "string") {
          this.addPattern(tool, pattern);
        }
      }
    }
  }

  private persist(): void {
    const data: Record<string, string[]> = {};
    for (const [tool, patterns] of this.store) {
      data[tool] = [...patterns];
    }
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }
}

let sharedAllowlist: Allowlist | null = null;

/** Process-wide {@link Allowlist} backed by `~/.hooman/allowlist.json`. */
export function getAllowlist(): Allowlist {
  if (!sharedAllowlist) {
    sharedAllowlist = new Allowlist();
  }
  return sharedAllowlist;
}
