import * as vscode from "vscode";
import { ensureDownloadedCli, type Logger } from "./cli-download";

/** Version of this extension; the CLI is resolved to the same version. */
const EXTENSION_VERSION = (require("../package.json") as { version: string })
  .version;

/** How to spawn the Hooman CLI. */
export interface HoomanLaunch {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  shell?: boolean;
}

/** Mark the process as the official VS Code host. */
function launchEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...extra,
    HOOMAN_X_VSCODE: "true",
  };
}

/**
 * Resolve how to launch the Hooman CLI for a subcommand.
 *
 * An explicit override is honoured verbatim. Otherwise the extension uses its
 * version-matched, checksum-verified release runtime. Package runners are not
 * suitable for ACP because install output can corrupt the stdout JSON stream,
 * and their bin resolution differs across npm, Bun, and platforms.
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
      env: launchEnv(),
    };
  }

  const { cliPath } = await ensureDownloadedCli(EXTENSION_VERSION, log);
  return {
    command: process.execPath,
    args: [cliPath, ...trailingArgs],
    env: launchEnv({ ELECTRON_RUN_AS_NODE: "1" }),
  };
}
