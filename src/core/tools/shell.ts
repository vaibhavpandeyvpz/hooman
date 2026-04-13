import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { tool } from "@strands-agents/sdk";
import type { JSONValue, ToolContext } from "@strands-agents/sdk";
import { z } from "zod";

const DEFAULT_TIMEOUT_SECONDS = Number.parseInt(
  process.env.SHELL_DEFAULT_TIMEOUT ?? "900",
  10,
);
const SIGKILL_TIMEOUT_MS = 200;
const MAX_OUTPUT_CHARS = 12_000;

const CommandObjectSchema = z.object({
  command: z.string().min(1).describe("Shell command to execute."),
  timeout: z
    .number()
    .positive()
    .optional()
    .describe("Per-command timeout in seconds."),
  work_dir: z.string().optional().describe("Per-command working directory."),
  stdin: z
    .string()
    .optional()
    .describe("Optional stdin content to send to the command."),
});

const CommandSchema = z.union([z.string(), CommandObjectSchema]);

type CommandInput = z.infer<typeof CommandSchema>;

type ShellConfig = {
  file: string;
  args: string[];
  windowsHide?: boolean;
};

type NormalizedCommand = {
  command: string;
  timeoutSeconds: number;
  workDir?: string;
  stdin?: string;
};

type CommandResult = {
  command: string;
  cwd: string;
  exit_code: number;
  status: "success" | "error";
  stdout: string;
  stderr: string;
  output: string;
  timed_out: boolean;
  duration_ms: number;
};

function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function trimOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) {
    return output;
  }
  return `${output.slice(0, MAX_OUTPUT_CHARS)}\n...[output truncated]`;
}

function which(command: string): string | undefined {
  const lookup = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(lookup, [command], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  if (result.status !== 0) {
    return undefined;
  }

  const first = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return first || undefined;
}

function shellName(file: string): string {
  const base =
    process.platform === "win32"
      ? path.win32.parse(file).name
      : path.basename(file);
  return base.toLowerCase();
}

function pickShell(shell?: string): string {
  if (shell?.trim()) {
    return shell.trim();
  }

  if (process.platform === "win32") {
    return (
      which("pwsh.exe") ||
      which("powershell.exe") ||
      process.env.COMSPEC ||
      "cmd.exe"
    );
  }

  return (
    process.env.SHELL ||
    (process.platform === "darwin" ? "/bin/zsh" : "/bin/sh")
  );
}

function shellConfig(command: string, shell?: string): ShellConfig {
  const file = pickShell(shell);
  const name = shellName(file);

  if (process.platform === "win32") {
    if (name === "pwsh" || name === "powershell") {
      return {
        file,
        args: ["-NoProfile", "-NonInteractive", "-Command", command],
        windowsHide: true,
      };
    }

    if (name === "bash" || name === "zsh" || name === "sh") {
      return { file, args: ["-lc", command], windowsHide: true };
    }

    return { file, args: ["/d", "/s", "/c", command], windowsHide: true };
  }

  return { file, args: ["-lc", command] };
}

async function killTree(
  proc: ChildProcess,
  opts?: { exited?: () => boolean },
): Promise<void> {
  const pid = proc.pid;
  if (!pid || opts?.exited?.()) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(pid), "/f", "/t"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("exit", () => resolve());
      killer.once("error", () => resolve());
    });
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
    await sleep(SIGKILL_TIMEOUT_MS);
    if (!opts?.exited?.()) {
      process.kill(-pid, "SIGKILL");
    }
  } catch {
    proc.kill("SIGTERM");
    await sleep(SIGKILL_TIMEOUT_MS);
    if (!opts?.exited?.()) {
      proc.kill("SIGKILL");
    }
  }
}

function resolveWorkDir(baseDir: string, workDir?: string): string {
  const raw = workDir?.trim();
  if (!raw) {
    return baseDir;
  }
  return path.resolve(baseDir, raw);
}

function normalizeCommands(
  input: z.infer<ReturnType<typeof createShellInputSchema>>,
): NormalizedCommand[] {
  const commands = Array.isArray(input.command)
    ? input.command
    : [input.command];

  return commands.map((entry) => {
    if (typeof entry === "string") {
      return {
        command: entry,
        timeoutSeconds: input.timeout ?? DEFAULT_TIMEOUT_SECONDS,
        workDir: input.work_dir,
      };
    }

    return {
      command: entry.command,
      timeoutSeconds: entry.timeout ?? input.timeout ?? DEFAULT_TIMEOUT_SECONDS,
      workDir: entry.work_dir ?? input.work_dir,
      stdin: entry.stdin,
    };
  });
}

function updateSequentialDir(currentDir: string, command: string): string {
  const trimmed = command.trim();
  const match = /^cd\s+(.+)$/.exec(trimmed);
  if (!match) {
    return currentDir;
  }

  const raw = match[1]!.trim().replace(/^['"]|['"]$/g, "");
  const nextDir = path.resolve(currentDir, raw);

  if (!existsSync(nextDir)) {
    return currentDir;
  }

  return nextDir;
}

async function executeOne(
  item: NormalizedCommand,
  cwd: string,
  context?: ToolContext,
): Promise<CommandResult> {
  const startedAt = Date.now();
  const cfg = shellConfig(item.command);

  let exited = false;
  let timedOut = false;
  let stdout = "";
  let stderr = "";

  const child = spawn(cfg.file, cfg.args, {
    cwd,
    env: process.env,
    detached: process.platform !== "win32",
    stdio: "pipe",
    windowsHide: cfg.windowsHide ?? false,
  });

  child.stdout?.on("data", (chunk: Buffer | string) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });

  if (item.stdin !== undefined) {
    child.stdin?.write(item.stdin);
  }
  child.stdin?.end();

  const timeoutMs = item.timeoutSeconds * 1000;

  return await new Promise<CommandResult>((resolve) => {
    const timeout = setTimeout(async () => {
      timedOut = true;
      await killTree(child, { exited: () => exited });
    }, timeoutMs);

    const abortHandler = async () => {
      await killTree(child, { exited: () => exited });
    };

    context?.agent.cancelSignal.addEventListener("abort", abortHandler, {
      once: true,
    });

    child.once("error", (error) => {
      exited = true;
      clearTimeout(timeout);
      context?.agent.cancelSignal.removeEventListener("abort", abortHandler);
      resolve({
        command: item.command,
        cwd,
        exit_code: 1,
        status: "error",
        stdout: trimOutput(stdout),
        stderr: trimOutput(`${stderr}\n${error.message}`.trim()),
        output: trimOutput(
          [stdout, stderr, error.message].filter(Boolean).join("\n"),
        ),
        timed_out: timedOut,
        duration_ms: Date.now() - startedAt,
      });
    });

    child.once("close", (code) => {
      exited = true;
      clearTimeout(timeout);
      context?.agent.cancelSignal.removeEventListener("abort", abortHandler);

      const exitCode = code ?? (timedOut ? 124 : 1);
      const combined = [stdout, stderr].filter(Boolean).join("\n");

      resolve({
        command: item.command,
        cwd,
        exit_code: exitCode,
        status: exitCode === 0 && !timedOut ? "success" : "error",
        stdout: trimOutput(stdout),
        stderr: trimOutput(stderr),
        output: trimOutput(combined),
        timed_out: timedOut,
        duration_ms: Date.now() - startedAt,
      });
    });
  });
}

async function executeSequential(
  commands: NormalizedCommand[],
  baseDir: string,
  ignoreErrors: boolean,
  context?: ToolContext,
): Promise<CommandResult[]> {
  const results: CommandResult[] = [];
  let currentDir = baseDir;

  for (const item of commands) {
    const cwd = resolveWorkDir(currentDir, item.workDir);
    const result = await executeOne(item, cwd, context);
    results.push(result);

    if (result.status === "success" && !item.workDir) {
      currentDir = updateSequentialDir(currentDir, item.command);
    }

    if (!ignoreErrors && result.status === "error") {
      break;
    }
  }

  return results;
}

async function executeParallel(
  commands: NormalizedCommand[],
  baseDir: string,
  ignoreErrors: boolean,
  context?: ToolContext,
): Promise<CommandResult[]> {
  const tasks = commands.map(async (item) =>
    executeOne(item, resolveWorkDir(baseDir, item.workDir), context),
  );

  const results = await Promise.all(tasks);
  if (ignoreErrors) {
    return results;
  }

  const firstError = results.findIndex((result) => result.status === "error");
  return firstError === -1 ? results : results.slice(0, firstError + 1);
}

function createShellInputSchema() {
  return z.object({
    command: z
      .union([CommandSchema, z.array(CommandSchema).min(1)])
      .describe(
        "Single command, command object, or list of commands/command objects.",
      ),
    parallel: z
      .boolean()
      .optional()
      .describe("Execute multiple commands in parallel."),
    ignore_errors: z
      .boolean()
      .optional()
      .describe("Continue executing even if a command fails."),
    timeout: z
      .number()
      .positive()
      .optional()
      .describe("Default timeout in seconds for each command."),
    work_dir: z
      .string()
      .optional()
      .describe("Base working directory for command execution."),
  });
}

export function createShellTools() {
  const inputSchema = createShellInputSchema();

  return [
    tool({
      name: "shell",
      description:
        "Execute shell commands on the local machine. Supports single commands, multiple commands, per-command options, sequential or parallel execution, working directories, stdin, and timeouts.",
      inputSchema,
      callback: async (input, context?: ToolContext) => {
        const commands = normalizeCommands(input);
        const parallel = input.parallel ?? false;
        const ignoreErrors = input.ignore_errors ?? false;
        const baseDir = resolveWorkDir(process.cwd(), input.work_dir);

        const results = parallel
          ? await executeParallel(commands, baseDir, ignoreErrors, context)
          : await executeSequential(commands, baseDir, ignoreErrors, context);

        const successCount = results.filter(
          (result) => result.status === "success",
        ).length;
        const errorCount = results.length - successCount;

        return toJsonValue({
          status: errorCount === 0 || ignoreErrors ? "success" : "error",
          execution_mode: parallel ? "parallel" : "sequential",
          total_commands: results.length,
          successful: successCount,
          failed: errorCount,
          base_dir: baseDir,
          results,
        });
      },
    }),
  ];
}
