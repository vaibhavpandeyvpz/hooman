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

export function getEnvironmentPromptContext(): EnvironmentPromptContext {
  const cwd = process.cwd();
  return {
    cwd,
    platform: detectPlatform(),
    osVersion: detectOsVersion(),
    shell: detectShell(),
    isGitRepo: detectGitRepo(cwd),
  };
}
