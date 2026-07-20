import { existsSync } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

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

/** Resolve the CLI entry bundled beside the compiled extension. */
function bundledCliPath(): string {
  const cliPath = path.resolve(__dirname, "../runtime/dist/cli.js");
  if (!existsSync(cliPath)) {
    throw new Error(
      `The bundled Hooman CLI is missing (${cliPath}). Reinstall the extension or set hooman.acp.command to a local CLI.`,
    );
  }
  return cliPath;
}

/**
 * Resolve how to launch the Hooman CLI for a subcommand.
 *
 * An explicit override is honoured verbatim. Otherwise the extension runs the
 * version-matched CLI packaged in its platform-specific VSIX.
 */
export async function resolveHoomanLaunch(
  trailingArgs: string[],
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

  return {
    command: process.execPath,
    args: [bundledCliPath(), ...trailingArgs],
    env: launchEnv({ ELECTRON_RUN_AS_NODE: "1" }),
  };
}
