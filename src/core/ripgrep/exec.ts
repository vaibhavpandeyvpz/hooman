import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { JSONValue, ToolContext } from "@strands-agents/sdk";
import { normalizeUserPath } from "../utils/normalize-user-path.js";

const execFileAsync = promisify(execFile);

const DEFAULT_RESULT_LIMIT = 500;
const MAX_BUFFER_BYTES = 20 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

export type OutputMode = "paths" | "content" | "files_with_matches" | "count";

type RipgrepExecutionResult = {
  stdout: string;
  stderr: string;
  code: number;
};

type ContentMatch = {
  file: string;
  line: number;
  column: number | null;
  content: string;
};

type CountMatch = {
  file: string;
  count: number;
};

type RipgrepError = Error & {
  code?: number | string;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
};

function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function normalizeForGlob(inputPath: string): string {
  return inputPath.replace(/\\/g, "/");
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizeForGlob(pattern);
  let regex = "^";

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i]!;
    const next = normalized[i + 1];

    if (char === "*" && next === "*") {
      regex += ".*";
      i += 1;
      continue;
    }

    if (char === "*") {
      regex += "[^/]*";
      continue;
    }

    if (char === "?") {
      regex += "[^/]";
      continue;
    }

    regex += /[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char;
  }

  regex += "$";
  return new RegExp(regex, "i");
}

function decodeExecOutput(value: string | Buffer | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  return "";
}

function parseLimit(input: {
  head_limit?: number;
  max_results?: number;
}): number {
  return input.head_limit ?? input.max_results ?? DEFAULT_RESULT_LIMIT;
}

function paginate<T>(
  input: T[],
  options: { offset?: number; limit: number },
): {
  totalCount: number;
  truncated: boolean;
  items: T[];
  offset: number;
  limit: number;
} {
  const offset = options.offset ?? 0;
  const limit = options.limit;
  const items = input.slice(offset, offset + limit);
  return {
    totalCount: input.length,
    truncated: offset + items.length < input.length,
    items,
    offset,
    limit,
  };
}

export async function executeRipgrep(
  rgPath: string,
  args: string[],
  options: { cwd: string; signal?: AbortSignal; timeoutMs?: number },
): Promise<RipgrepExecutionResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const result = await execFileAsync(rgPath, args, {
      cwd: options.cwd,
      windowsHide: true,
      maxBuffer: MAX_BUFFER_BYTES,
      signal: options.signal,
      timeout: timeoutMs,
      env: {
        ...process.env,
        NO_COLOR: "1",
        FORCE_COLOR: "0",
      },
    });
    return {
      stdout: decodeExecOutput(result.stdout),
      stderr: decodeExecOutput(result.stderr),
      code: 0,
    };
  } catch (error) {
    const err = error as RipgrepError;
    const stdout = decodeExecOutput(err.stdout);
    const stderr = decodeExecOutput(err.stderr);
    const code = typeof err.code === "number" ? err.code : -1;

    // ripgrep exits 1 when no matches are found.
    if (code === 1) {
      return { stdout, stderr, code };
    }

    if (options.signal?.aborted) {
      throw new Error("ripgrep command was cancelled.");
    }

    if (
      code === 2 &&
      (stderr.includes("regex parse error") ||
        stderr.includes("error parsing regex"))
    ) {
      throw new Error(`Invalid ripgrep pattern: ${stderr.trim()}`);
    }

    const message = stderr.trim() || err.message || "ripgrep execution failed.";
    throw new Error(`ripgrep failed: ${message}`);
  }
}

function appendSearchFlags(
  args: string[],
  input: {
    case_insensitive?: boolean;
    fixed_strings?: boolean;
    multiline?: boolean;
    no_ignore?: boolean;
    type?: string;
    glob?: string;
    exclude_patterns?: string[];
    context?: number;
    before?: number;
    after?: number;
  },
): void {
  if (input.case_insensitive) {
    args.push("-i");
  }
  if (input.fixed_strings) {
    args.push("-F");
  }
  if (input.multiline) {
    args.push("-U", "--multiline-dotall");
  }
  if (input.no_ignore) {
    args.push("--no-ignore");
  }
  if (input.type) {
    args.push(`--type=${input.type}`);
  }
  if (input.glob) {
    args.push(`--glob=${input.glob}`);
  }
  for (const pattern of input.exclude_patterns ?? []) {
    args.push(`--glob=!${pattern}`);
  }
  if (typeof input.context === "number") {
    args.push("-C", String(input.context));
  } else {
    if (typeof input.before === "number") {
      args.push("-B", String(input.before));
    }
    if (typeof input.after === "number") {
      args.push("-A", String(input.after));
    }
  }
}

async function requireExistingPath(inputPath: string): Promise<{
  targetPath: string;
  isFile: boolean;
  isDirectory: boolean;
}> {
  const targetPath = normalizeUserPath(inputPath);
  const stat = await fs.stat(targetPath).catch(() => null);
  if (!stat) {
    throw new Error(`Path does not exist: ${targetPath}`);
  }
  return {
    targetPath,
    isFile: stat.isFile(),
    isDirectory: stat.isDirectory(),
  };
}

export async function runPathsMode(
  rgPath: string,
  input: {
    path: string;
    pattern: string;
    exclude_patterns?: string[];
    offset?: number;
    head_limit?: number;
    max_results?: number;
  },
  context?: ToolContext,
): Promise<JSONValue> {
  const resolved = await requireExistingPath(input.path);
  if (!resolved.isDirectory) {
    throw new Error(
      `output_mode=paths requires a directory path, got: ${resolved.targetPath}`,
    );
  }

  const command = await executeRipgrep(
    rgPath,
    ["--no-config", "--files", "--hidden", "--no-ignore", "."],
    {
      cwd: resolved.targetPath,
      signal: context?.agent.cancelSignal,
    },
  );

  const matcher = globToRegExp(input.pattern);
  const excludes = (input.exclude_patterns ?? []).map(globToRegExp);
  const allMatches: string[] = [];
  for (const line of command.stdout.split(/\r?\n/)) {
    const relative = line.trim();
    if (!relative) {
      continue;
    }
    const normalized = normalizeForGlob(relative);
    if (excludes.some((exclude) => exclude.test(normalized))) {
      continue;
    }
    if (!matcher.test(normalized) && !matcher.test(path.basename(normalized))) {
      continue;
    }
    allMatches.push(path.resolve(resolved.targetPath, relative));
  }

  const page = paginate(allMatches, {
    offset: input.offset,
    limit: parseLimit(input),
  });
  return toJsonValue({
    path: resolved.targetPath,
    pattern: input.pattern,
    output_mode: "paths",
    count: page.items.length,
    total_count: page.totalCount,
    offset: page.offset,
    head_limit: page.limit,
    truncated: page.truncated,
    matches: page.items,
  });
}

export async function runContentMode(
  rgPath: string,
  mode: Exclude<OutputMode, "paths">,
  input: {
    path: string;
    pattern: string;
    glob?: string;
    type?: string;
    exclude_patterns?: string[];
    context?: number;
    before?: number;
    after?: number;
    case_insensitive?: boolean;
    fixed_strings?: boolean;
    multiline?: boolean;
    no_ignore?: boolean;
    offset?: number;
    head_limit?: number;
    max_results?: number;
  },
  context?: ToolContext,
): Promise<JSONValue> {
  const resolved = await requireExistingPath(input.path);
  if (!resolved.isDirectory && !resolved.isFile) {
    throw new Error(`Path is not searchable: ${resolved.targetPath}`);
  }

  const cwd = resolved.isDirectory
    ? resolved.targetPath
    : path.dirname(resolved.targetPath);
  const searchTarget = resolved.isDirectory
    ? "."
    : path.basename(resolved.targetPath);
  const args = ["--no-config", "--hidden", "--color", "never"];

  if (mode === "content") {
    args.push("--json", "--line-number", "--column", "--no-heading");
  } else if (mode === "files_with_matches") {
    args.push("-l");
  } else {
    args.push("--count", "--with-filename");
  }

  appendSearchFlags(args, input);
  args.push("--", input.pattern, searchTarget);

  const execution = await executeRipgrep(rgPath, args, {
    cwd,
    signal: context?.agent.cancelSignal,
  });

  if (mode === "content") {
    const parsed: ContentMatch[] = [];
    for (const line of execution.stdout.split(/\r?\n/)) {
      const jsonLine = line.trim();
      if (!jsonLine) {
        continue;
      }

      try {
        const event = JSON.parse(jsonLine) as {
          type?: string;
          data?: {
            path?: { text?: string };
            line_number?: number;
            lines?: { text?: string };
            submatches?: Array<{ start?: number }>;
          };
        };
        if (event.type !== "match" || !event.data?.path?.text) {
          continue;
        }

        parsed.push({
          file: path.resolve(cwd, event.data.path.text),
          line: event.data.line_number ?? 0,
          column:
            typeof event.data.submatches?.[0]?.start === "number"
              ? event.data.submatches[0].start + 1
              : null,
          content: (event.data.lines?.text ?? "").replace(/\r?\n$/, ""),
        });
      } catch {
        continue;
      }
    }

    const page = paginate(parsed, {
      offset: input.offset,
      limit: parseLimit(input),
    });
    return toJsonValue({
      path: resolved.targetPath,
      pattern: input.pattern,
      output_mode: mode,
      count: page.items.length,
      total_count: page.totalCount,
      offset: page.offset,
      head_limit: page.limit,
      truncated: page.truncated,
      matches: page.items,
    });
  }

  if (mode === "files_with_matches") {
    const parsed = execution.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((filePath) => path.resolve(cwd, filePath));
    const page = paginate(parsed, {
      offset: input.offset,
      limit: parseLimit(input),
    });
    return toJsonValue({
      path: resolved.targetPath,
      pattern: input.pattern,
      output_mode: mode,
      count: page.items.length,
      total_count: page.totalCount,
      offset: page.offset,
      head_limit: page.limit,
      truncated: page.truncated,
      files: page.items,
    });
  }

  const counts: CountMatch[] = [];
  for (const line of execution.stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const suffix = trimmed.match(/:(\d+)$/);
    if (!suffix || typeof suffix.index !== "number") {
      continue;
    }

    const filePart = trimmed.slice(0, suffix.index);
    const count = Number.parseInt(suffix[1]!, 10);
    if (!Number.isFinite(count)) {
      continue;
    }
    counts.push({
      file: path.resolve(cwd, filePart),
      count,
    });
  }

  const page = paginate(counts, {
    offset: input.offset,
    limit: parseLimit(input),
  });
  return toJsonValue({
    path: resolved.targetPath,
    pattern: input.pattern,
    output_mode: mode,
    count: page.items.length,
    total_count: page.totalCount,
    offset: page.offset,
    head_limit: page.limit,
    truncated: page.truncated,
    counts: page.items,
  });
}
