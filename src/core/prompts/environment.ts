import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  release as osRelease,
  type as osType,
  version as osVersion,
} from "node:os";

type EnvironmentPromptContext = {
  cwd: string;
  platform: string;
  osVersion: string;
  shell: string;
  isGitRepo: boolean;
  timeZone: string;
  datetime: string;
};

function detectPlatform(): string {
  return ["darwin", "linux", "win32"].includes(process.platform)
    ? process.platform
    : process.platform;
}

function detectOsVersion(): string {
  if (process.platform === "win32") {
    return `${osVersion()} ${osRelease()}`;
  }
  return `${osType()} ${osRelease()}`;
}

function detectShell(): string {
  const shell =
    process.env.SHELL ||
    process.env.ComSpec ||
    process.env.COMSPEC ||
    "unknown";
  return shell.trim() || "unknown";
}

function detectGitRepo(startDir: string): boolean {
  let current = startDir;
  while (true) {
    if (existsSync(join(current, ".git"))) {
      return true;
    }
    const parent = dirname(current);
    if (parent === current) {
      return false;
    }
    current = parent;
  }
}

function detectTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
}

/** Human-readable local date & time, e.g. "Saturday, July 4, 2026, 2:25 PM". */
export function formatPromptDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
  }).format(date);
}

/**
 * Environment facts rendered into the system prompt. `at` is the moment the
 * prompt is considered built; callers that rebuild the prompt during a session
 * must pass a stable value so the rendered prefix stays byte-identical across
 * turns (a changing prefix defeats provider prompt caching).
 */
export function getEnvironmentPromptContext(
  at: Date = new Date(),
): EnvironmentPromptContext {
  const cwd = process.cwd();
  return {
    cwd,
    platform: detectPlatform(),
    osVersion: detectOsVersion(),
    shell: detectShell(),
    isGitRepo: detectGitRepo(cwd),
    timeZone: detectTimeZone(),
    datetime: formatPromptDateTime(at),
  };
}
