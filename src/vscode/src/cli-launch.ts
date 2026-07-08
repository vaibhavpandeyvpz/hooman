import { spawnSync } from "node:child_process";
import * as vscode from "vscode";
import { ensureDownloadedCli, type Logger } from "./cli-download";

/** Version of this extension; the CLI is resolved to the same version. */
const EXTENSION_VERSION = (require("../package.json") as { version: string })
  .version;

/**
 * How to spawn the Hooman CLI: the executable, its arguments, and the
 * environment to run it with.
 */
export interface HoomanLaunch {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/** On Windows, `npx`/`bunx` are `.cmd` shims that `spawn` needs named explicitly. */
function platformCommand(name: string): string {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

/** Whether an executable is resolvable on the current PATH. */
function onPath(command: string): boolean {
  const lookup = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(lookup, [command], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0;
}

/** Prefer `bunx` (Bun) then `npx` (Node) as a version-pinned package runner. */
function firstAvailableRunner(): "npx" | "bunx" | undefined {
  if (onPath("bunx")) {
    return "bunx";
  }
  if (onPath("npx")) {
    return "npx";
  }
  return undefined;
}

/**
 * Resolve how to launch the Hooman CLI for a given subcommand (e.g. `["acp"]`
 * or `["mcp", "auth", name]`), following the resolution ladder:
 *
 * 1. An explicit `hooman.acp.command` override — honoured verbatim, with the
 *    subcommand appended after stripping a trailing `acp` from `hooman.acp.args`.
 * 2. `bunx`/`npx` on PATH — run `bunx hoomanjs@<version> …` (or `npx -y …`),
 *    preferring Bun, pinned to this extension's version for compatibility.
 * 3. Otherwise download the prebuilt, self-contained CLI for this platform
 *    (its `node_modules` already includes the native runtimes) and run it with
 *    VS Code's own Node runtime (`process.execPath` + `ELECTRON_RUN_AS_NODE=1`)
 *    — no `node`/`npx` on PATH required.
 */
export async function resolveHoomanLaunch(
  trailingArgs: string[],
  log?: Logger,
): Promise<HoomanLaunch> {
  const config = vscode.workspace.getConfiguration("hooman");

  const override = (config.get<string>("acp.command") ?? "").trim();
  if (override) {
    const baseArgs = config.get<string[]>("acp.args") ?? ["hoomanjs", "acp"];
    const stripped =
      baseArgs.length > 0 && baseArgs[baseArgs.length - 1] === "acp"
        ? baseArgs.slice(0, -1)
        : baseArgs;
    return {
      command: override,
      args: [...stripped, ...trailingArgs],
      env: process.env,
    };
  }

  const runner = firstAvailableRunner();
  if (runner === "npx") {
    return {
      command: platformCommand("npx"),
      args: ["-y", `hoomanjs@${EXTENSION_VERSION}`, ...trailingArgs],
      env: process.env,
    };
  }
  if (runner === "bunx") {
    return {
      command: platformCommand("bunx"),
      args: [`hoomanjs@${EXTENSION_VERSION}`, ...trailingArgs],
      env: process.env,
    };
  }

  const { cliPath } = await ensureDownloadedCli(EXTENSION_VERSION, log);
  return {
    command: process.execPath,
    args: [cliPath, ...trailingArgs],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
    },
  };
}
