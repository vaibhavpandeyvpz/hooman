import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { tool } from "@strands-agents/sdk";
import type { JSONValue, ToolContext } from "@strands-agents/sdk";
import { z } from "zod";
import { getCwd } from "../utils/cwd-context.js";
import { lookupCommandPath } from "../utils/command-path.js";
import { getShellJobManager } from "./registry.js";
import { getTerminalBackend } from "./terminal-backend.js";

export type {
  TerminalBackend,
  TerminalOutputSnapshot,
  TerminalRunRequest,
  TerminalRunResult,
  TerminalSpawnResult,
} from "./terminal-backend.js";
export { getTerminalBackend, setTerminalBackend } from "./terminal-backend.js";

export const SHELL_TOOL_NAME = "shell";
export const SHELL_OUTPUT_TOOL_NAME = "shell_output";
export const SHELL_STOP_TOOL_NAME = "shell_stop";

const DEFAULT_TIMEOUT_SECONDS = Number.parseInt(
  process.env.SHELL_DEFAULT_TIMEOUT ?? "900",
  10,
);
const SIGKILL_TIMEOUT_MS = 200;
const MAX_OUTPUT_CHARS = 12_000;
/** Output bytes the host terminal should retain before truncating. */
const TERMINAL_OUTPUT_BYTE_LIMIT = 1_048_576;

const NotifyOnOutputSchema = z.object({
  pattern: z
    .string()
    .min(1)
    .describe("JavaScript regex matched against accumulated output."),
  debounce_ms: z
    .number()
    .nonnegative()
    .optional()
    .describe("Milliseconds between match checks."),
});

const ReadyProbeSchema = z.object({
  pattern: z
    .string()
    .min(1)
    .optional()
    .describe("Regex matched against output to mark the job ready."),
  port: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Local TCP port to probe until it accepts connections."),
  timeout_ms: z
    .number()
    .positive()
    .optional()
    .describe("Milliseconds to wait for readiness before returning."),
});

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

type BackgroundShellResult = {
  status: "background";
  job_id: string;
  description: string;
  output: string;
  ready: boolean;
  truncated: boolean;
  job_status: string;
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
  return lookupCommandPath(command);
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

async function executeViaTerminal(
  item: NormalizedCommand,
  cwd: string,
  context: ToolContext,
): Promise<CommandResult> {
  const backend = getTerminalBackend(context.agent)!;
  const startedAt = Date.now();
  const cfg = shellConfig(item.command);

  const result = await backend.run({
    toolUseId: context.toolUse?.toolUseId,
    command: cfg.file,
    args: cfg.args,
    cwd,
    timeoutMs: item.timeoutSeconds * 1000,
    outputByteLimit: TERMINAL_OUTPUT_BYTE_LIMIT,
    cancelSignal: context.agent.cancelSignal,
  });

  const output = trimOutput(result.output);
  const exitCode = result.timedOut
    ? 124
    : (result.exitCode ?? (result.signal ? 137 : 1));

  return {
    command: item.command,
    cwd,
    exit_code: exitCode,
    status: exitCode === 0 && !result.timedOut ? "success" : "error",
    stdout: output,
    stderr: "",
    output,
    timed_out: result.timedOut,
    duration_ms: Date.now() - startedAt,
  };
}

async function executeOne(
  item: NormalizedCommand,
  cwd: string,
  context?: ToolContext,
): Promise<CommandResult> {
  // Route through the host terminal when available. The ACP `terminal/create`
  // API has no stdin channel, so commands that pipe stdin stay local.
  if (
    context &&
    item.stdin === undefined &&
    getTerminalBackend(context.agent)
  ) {
    return executeViaTerminal(item, cwd, context);
  }

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
    run_in_background: z
      .boolean()
      .optional()
      .describe(
        "Run a single command as a background job and return a job_id immediately. Requires description. Use shell_output / shell_stop to manage it.",
      ),
    description: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Short human-readable label for a background job (required when run_in_background is true).",
      ),
    notify_on_output: NotifyOnOutputSchema.optional().describe(
      "Block until this regex matches output (or timeout), then return a job_id while the process keeps running.",
    ),
    ready: ReadyProbeSchema.optional().describe(
      "Wait for a readiness probe (regex and/or TCP port) before returning a background job handle.",
    ),
    block_until_ms: z
      .number()
      .nonnegative()
      .optional()
      .describe(
        "Max milliseconds to wait before returning a background handle. 0 = return immediately (same as run_in_background). With notify_on_output/ready, caps how long to wait for the match.",
      ),
  });
}

function wantsBackground(
  input: z.infer<ReturnType<typeof createShellInputSchema>>,
): boolean {
  return (
    input.run_in_background === true ||
    input.block_until_ms !== undefined ||
    input.notify_on_output !== undefined ||
    input.ready !== undefined
  );
}

async function executeBackground(
  input: z.infer<ReturnType<typeof createShellInputSchema>>,
  context: ToolContext,
): Promise<BackgroundShellResult> {
  if (Array.isArray(input.command)) {
    throw new Error(
      "Background shell jobs support a single command only (not an array).",
    );
  }

  const runInBackground =
    input.run_in_background === true || input.block_until_ms === 0;
  const description =
    input.description?.trim() ||
    (typeof input.command === "string"
      ? input.command.slice(0, 80)
      : input.command.command.slice(0, 80));

  if (runInBackground && !input.description?.trim()) {
    throw new Error(
      "description is required when run_in_background is true (or block_until_ms is 0).",
    );
  }

  const commands = normalizeCommands(input);
  const item = commands[0]!;
  if (item.stdin !== undefined) {
    throw new Error("Background shell jobs do not support stdin.");
  }

  const baseDir = resolveWorkDir(getCwd(), input.work_dir);
  const cwd = resolveWorkDir(baseDir, item.workDir);
  const cfg = shellConfig(item.command);
  const manager = getShellJobManager(context.agent);

  let blockUntilMs = input.block_until_ms;
  if (runInBackground && blockUntilMs === undefined) {
    blockUntilMs = 0;
  }

  const snap = await manager.start({
    command: cfg.file,
    args: cfg.args,
    cwd,
    description,
    timeoutMs: item.timeoutSeconds * 1000,
    outputByteLimit: TERMINAL_OUTPUT_BYTE_LIMIT,
    toolUseId: context.toolUse?.toolUseId,
    notifyOnOutput: input.notify_on_output,
    ready: input.ready,
    blockUntilMs,
    cancelSignal: context.agent.cancelSignal,
  });

  return {
    status: "background",
    job_id: snap.jobId,
    description,
    output: snap.output,
    ready: snap.ready,
    truncated: snap.truncated,
    job_status: snap.status,
  };
}

export function createShellTools() {
  const inputSchema = createShellInputSchema();

  return [
    tool({
      name: SHELL_TOOL_NAME,
      description:
        "Execute shell commands on the local machine. Supports single commands, multiple commands, per-command options, sequential or parallel execution, working directories, stdin, and timeouts. For long-running processes (servers, watchers, monitors), set run_in_background with a description to get a job_id, then use shell_output / shell_stop. Use notify_on_output or ready to wait until the process is useful before returning.",
      inputSchema,
      callback: async (input, context?: ToolContext) => {
        if (wantsBackground(input)) {
          if (!context?.agent) {
            throw new Error("Background shell jobs require an agent context.");
          }
          return toJsonValue(await executeBackground(input, context));
        }

        const commands = normalizeCommands(input);
        const parallel = input.parallel ?? false;
        const ignoreErrors = input.ignore_errors ?? false;
        const baseDir = resolveWorkDir(getCwd(), input.work_dir);

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
    tool({
      name: SHELL_OUTPUT_TOOL_NAME,
      description:
        "Read output from a background shell job started with shell (run_in_background / notify_on_output / ready). By default blocks until the job exits. Set block=false for a snapshot, or pass pattern to wait for a new regex match. Prefer waiting with a reasonable timeout over tight polling loops.",
      inputSchema: z.object({
        job_id: z.string().min(1).describe("Background job id from shell."),
        block: z
          .boolean()
          .optional()
          .describe(
            "When true (default), wait for the job to exit. Ignored when pattern is set.",
          ),
        timeout_ms: z
          .number()
          .positive()
          .optional()
          .describe("Max wait time in milliseconds (default 30000)."),
        pattern: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Wait for this JavaScript regex to match new output since the last read.",
          ),
        tail_lines: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Return only the last N lines of output."),
      }),
      callback: async (input, context?: ToolContext) => {
        if (!context?.agent) {
          throw new Error("shell_output requires an agent context.");
        }
        const manager = getShellJobManager(context.agent);
        const snap = await manager.output(input.job_id, {
          block: input.block,
          timeoutMs: input.timeout_ms,
          pattern: input.pattern,
          tailLines: input.tail_lines,
          cancelSignal: context.agent.cancelSignal,
        });
        return toJsonValue({
          status: snap.status,
          job_id: snap.jobId,
          output: snap.output,
          truncated: snap.truncated,
          ready: snap.ready,
          exit_code: snap.exitCode,
          signal: snap.signal,
          matched: snap.matched,
        });
      },
    }),
    tool({
      name: SHELL_STOP_TOOL_NAME,
      description:
        "Stop a background shell job started with shell (run_in_background / notify_on_output / ready). Sends a process-group kill and returns the final status.",
      inputSchema: z.object({
        job_id: z.string().min(1).describe("Background job id from shell."),
      }),
      callback: async (input, context?: ToolContext) => {
        if (!context?.agent) {
          throw new Error("shell_stop requires an agent context.");
        }
        const manager = getShellJobManager(context.agent);
        const snap = await manager.stop(input.job_id);
        return toJsonValue({
          status: "stopped",
          job_id: snap.jobId,
          job_status: snap.status,
          exit_code: snap.exitCode,
          signal: snap.signal,
          output: snap.output,
        });
      },
    }),
  ];
}
