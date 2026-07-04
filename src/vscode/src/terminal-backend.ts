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

/**
 * Backs the ACP `terminal/*` client methods with plain child processes.
 *
 * This does not spawn a visible VS Code integrated terminal — VS Code's shell
 * integration APIs for capturing arbitrary command output are not reliable
 * enough across shells/platforms for this purpose. Output is captured
 * directly from the child process's stdio instead, which is simpler and
 * gives byte-accurate output/exit-code reporting to the agent.
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
    });
    const state: TerminalState = {
      child,
      output: "",
      truncated: false,
      byteLimit: request.outputByteLimit ?? undefined,
      exitStatus: null,
      exitWaiters: [],
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

  kill(request: KillTerminalRequest): void {
    const state = this.#terminals.get(request.terminalId);
    if (state && !state.exitStatus) {
      state.child.kill();
    }
  }

  release(request: ReleaseTerminalRequest): void {
    const state = this.#terminals.get(request.terminalId);
    if (state && !state.exitStatus) {
      state.child.kill();
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
      if (!state.exitStatus) {
        state.child.kill();
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
}

type TerminalState = {
  child: cp.ChildProcess;
  output: string;
  truncated: boolean;
  byteLimit: number | undefined;
  exitStatus: TerminalExitStatus | null;
  exitWaiters: Array<() => void>;
};
