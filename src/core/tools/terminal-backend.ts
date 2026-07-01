/**
 * Optional per-agent terminal backend.
 *
 * When an embedding host (e.g. an ACP client that advertises the `terminal`
 * capability) can run shell commands on the agent's behalf, it registers a
 * backend here. The built-in `shell` tool then executes through it so the host
 * can stream live output and embed the terminal in the tool call. When no
 * backend is registered, the tool spawns commands locally.
 */
export type TerminalRunRequest = {
  /** ACP tool-call id, so the host can embed the live terminal in the call. */
  toolUseId?: string;
  /** Program to execute (already resolved to a shell binary + args). */
  command: string;
  args: string[];
  /** Absolute working directory. */
  cwd: string;
  /** Timeout in milliseconds; the backend kills the command when it elapses. */
  timeoutMs: number;
  /** Maximum output bytes the host should retain. */
  outputByteLimit?: number;
  /** Aborts the command (e.g. prompt-turn cancellation). */
  cancelSignal?: AbortSignal;
};

export type TerminalRunResult = {
  /** Combined terminal output captured so far. */
  output: string;
  /** Whether the host truncated output due to byte limits. */
  truncated: boolean;
  /** Process exit code, or `null` when killed by a signal. */
  exitCode: number | null;
  /** Signal that terminated the process, or `null`. */
  signal: string | null;
  /** Whether the command was killed because it exceeded the timeout. */
  timedOut: boolean;
};

export type TerminalBackend = {
  run(request: TerminalRunRequest): Promise<TerminalRunResult>;
};

/** Keyed by the Strands agent instance so backends are never serialized. */
const backends = new WeakMap<object, TerminalBackend>();

export function setTerminalBackend(
  agent: object,
  backend: TerminalBackend,
): void {
  backends.set(agent, backend);
}

export function getTerminalBackend(
  agent: object | undefined,
): TerminalBackend | undefined {
  return agent ? backends.get(agent) : undefined;
}
