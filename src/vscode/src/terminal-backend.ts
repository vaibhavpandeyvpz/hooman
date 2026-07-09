import * as cp from "node:child_process";
import * as vscode from "vscode";
import type {
  CreateTerminalRequest,
  CreateTerminalResponse,
  KillTerminalRequest,
  ReleaseTerminalRequest,
  TerminalExitStatus,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
} from "@agentclientprotocol/sdk";

const SIGKILL_TIMEOUT_MS = 500;

/**
 * Backs the ACP `terminal/*` client methods with plain child processes.
 *
 * This does not spawn a visible VS Code integrated terminal — VS Code's shell
 * integration APIs for capturing arbitrary command output are not reliable
 * enough across shells/platforms for this purpose. Output is captured
 * directly from the child process's stdio instead, which is simpler and
 * gives byte-accurate output/exit-code reporting to the agent.
 *
 * On Unix, children are spawned in their own process group so kill can tear
 * down the whole tree (shell + `top`, servers, etc.).
 */
export class TerminalBackend implements vscode.Disposable {
  readonly #terminals = new Map<string, TerminalState>();
  #nextId = 1;

  constructor(private readonly outputChannel: vscode.LogOutputChannel) {}

  create(request: CreateTerminalRequest): CreateTerminalResponse {
    const terminalId = `term-${this.#nextId++}`;
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const { name, value } of request.env ?? []) {
      env[name] = value;
    }
    const child = cp.spawn(request.command, request.args ?? [], {
      cwd: request.cwd ?? undefined,
      env,
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    const state: TerminalState = {
      child,
      output: "",
      truncated: false,
      byteLimit: request.outputByteLimit ?? undefined,
      exitStatus: null,
      exitWaiters: [],
      killing: false,
    };
    this.#terminals.set(terminalId, state);

    const onData = (chunk: Buffer) => this.#appendOutput(state, chunk);
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (error) => {
      this.outputChannel.warn(
        `[terminal:${terminalId}] failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
      state.exitStatus = { exitCode: null, signal: null };
      this.#settleExit(state);
    });
    child.on("exit", (code, signal) => {
      state.exitStatus = { exitCode: code, signal };
      this.#settleExit(state);
    });

    return { terminalId };
  }

  output(request: TerminalOutputRequest): TerminalOutputResponse {
    const state = this.#require(request.terminalId);
    return {
      output: state.output,
      truncated: state.truncated,
      exitStatus: state.exitStatus,
    };
  }

  async waitForExit(
    request: WaitForTerminalExitRequest,
  ): Promise<WaitForTerminalExitResponse> {
    const state = this.#require(request.terminalId);
    if (state.exitStatus) {
      return {
        exitCode: state.exitStatus.exitCode,
        signal: state.exitStatus.signal,
      };
    }
    return new Promise((resolve) => {
      state.exitWaiters.push(() =>
        resolve({
          exitCode: state.exitStatus?.exitCode ?? null,
          signal: state.exitStatus?.signal ?? null,
        }),
      );
    });
  }

  async kill(request: KillTerminalRequest): Promise<void> {
    const state = this.#terminals.get(request.terminalId);
    if (!state || state.exitStatus) {
      return;
    }
    if (state.killing) {
      // A prior kill/release is in flight — wait for it, then force another
      // attempt if the process is somehow still alive.
      await this.#waitForExit(state, 5_000);
      if (!state.exitStatus) {
        await this.#killTree(state);
      }
      return;
    }
    state.killing = true;
    await this.#killTree(state);
  }

  async release(request: ReleaseTerminalRequest): Promise<void> {
    const state = this.#terminals.get(request.terminalId);
    if (state && !state.exitStatus) {
      if (!state.killing) {
        state.killing = true;
        await this.#killTree(state);
      } else {
        await this.#waitForExit(state, 5_000);
        if (!state.exitStatus) {
          await this.#killTree(state);
        }
      }
    }
    // Intentionally retained in the map: the agent references released
    // terminals in completed tool_call_update content (`type: "terminal"`),
    // and the UI resolves their output via `outputText`.
  }

  /** Best-effort output lookup for UI display; works after release. */
  outputText(terminalId: string): string | undefined {
    return this.#terminals.get(terminalId)?.output;
  }

  dispose(): void {
    for (const state of this.#terminals.values()) {
      if (!state.exitStatus && !state.killing) {
        state.killing = true;
        void this.#killTree(state).catch(() => undefined);
      }
    }
    this.#terminals.clear();
  }

  #require(terminalId: string): TerminalState {
    const state = this.#terminals.get(terminalId);
    if (!state) {
      throw new Error(`Unknown terminal id "${terminalId}"`);
    }
    return state;
  }

  #appendOutput(state: TerminalState, chunk: Buffer): void {
    state.output += chunk.toString("utf8");
    if (
      state.byteLimit &&
      Buffer.byteLength(state.output, "utf8") > state.byteLimit
    ) {
      state.truncated = true;
      while (
        state.output.length > 0 &&
        Buffer.byteLength(state.output, "utf8") > state.byteLimit
      ) {
        state.output = state.output.slice(1);
      }
    }
  }

  #settleExit(state: TerminalState): void {
    const waiters = state.exitWaiters;
    state.exitWaiters = [];
    for (const waiter of waiters) {
      waiter();
    }
  }

  async #killTree(state: TerminalState): Promise<void> {
    const proc = state.child;
    const pid = proc.pid;
    if (!pid || state.exitStatus) {
      return;
    }

    if (process.platform === "win32") {
      await new Promise<void>((resolve) => {
        const killer = cp.spawn("taskkill", ["/pid", String(pid), "/f", "/t"], {
          stdio: "ignore",
          windowsHide: true,
        });
        killer.once("exit", () => resolve());
        killer.once("error", () => resolve());
      });
      await this.#waitForExit(state, 2_000);
      return;
    }

    // Prefer process-group signals (detached spawn). Fall back to the child
    // handle, then to `/bin/kill` — Electron/extension hosts sometimes reject
    // `process.kill(-pid)` with EPERM even when the process is ours.
    this.#signalGroup(pid, "SIGTERM");
    try {
      proc.kill("SIGTERM");
    } catch {
      // already gone
    }
    if (await this.#waitForExit(state, SIGKILL_TIMEOUT_MS)) {
      return;
    }

    this.#signalGroup(pid, "SIGKILL");
    try {
      proc.kill("SIGKILL");
    } catch {
      // already gone
    }
    if (await this.#waitForExit(state, SIGKILL_TIMEOUT_MS)) {
      return;
    }

    await this.#shellKill(pid, "TERM");
    if (await this.#waitForExit(state, SIGKILL_TIMEOUT_MS)) {
      return;
    }
    await this.#shellKill(pid, "KILL");
    await this.#waitForExit(state, 1_000);
  }

  /** Send a signal to a process group (`-pid`) and the leader pid. */
  #signalGroup(pid: number, signal: NodeJS.Signals): void {
    try {
      process.kill(-pid, signal);
    } catch {
      // EPERM / ESRCH — try the leader alone below
    }
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }

  /** Last-resort kill via `/bin/kill` (works when Node's kill is restricted). */
  async #shellKill(pid: number, signal: "TERM" | "KILL"): Promise<void> {
    await new Promise<void>((resolve) => {
      // Kill the process group first (`-pid`), then the leader pid.
      const killer = cp.spawn(
        "/bin/kill",
        [`-${signal}`, `-${pid}`, String(pid)],
        { stdio: "ignore" },
      );
      killer.once("exit", () => resolve());
      killer.once("error", () => resolve());
    });
  }

  #waitForExit(state: TerminalState, timeoutMs: number): Promise<boolean> {
    if (state.exitStatus) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve(Boolean(state.exitStatus));
      }, timeoutMs);
      const onExit = () => {
        cleanup();
        resolve(true);
      };
      const cleanup = () => {
        clearTimeout(timer);
        state.child.off("exit", onExit);
      };
      state.child.once("exit", onExit);
      if (state.exitStatus) {
        cleanup();
        resolve(true);
      }
    });
  }
}

type TerminalState = {
  child: cp.ChildProcess;
  output: string;
  truncated: boolean;
  byteLimit: number | undefined;
  exitStatus: TerminalExitStatus | null;
  exitWaiters: Array<() => void>;
  killing: boolean;
};
