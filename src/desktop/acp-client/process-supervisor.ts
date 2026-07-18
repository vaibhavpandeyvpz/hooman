import { EventEmitter } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { NdjsonRpcConnection, type AgentRequestHandler } from "./transport.js";

export type AcpLaunchSpec = {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
};

export type AcpProcessState =
  "idle" | "starting" | "ready" | "crashed" | "stopped";

const STDERR_RING_BUFFER_BYTES = 16_384;
const MAX_RESTART_ATTEMPTS = 3;
const RESTART_BACKOFF_MS = [1_000, 4_000, 10_000];

/**
 * Supervises exactly one `hooman acp` child process bound to a single
 * canonical project root, per the plan's per-project process model (ACP
 * session storage and bootstrap resolution are process/cwd scoped today).
 * Restarts on unexpected exit with bounded backoff; never restarts while a
 * destructive/pending-approval turn is in flight (`lockRestarts`).
 */
export class AcpProcessSupervisor extends EventEmitter {
  #spec: AcpLaunchSpec;
  #agentRequestHandler: AgentRequestHandler;
  #child: ChildProcessWithoutNullStreams | null = null;
  #connection: NdjsonRpcConnection | null = null;
  #state: AcpProcessState = "idle";
  #stderrBuffer = "";
  #restartAttempts = 0;
  #restartsLocked = false;
  #starting: Promise<void> | null = null;

  constructor(spec: AcpLaunchSpec, agentRequestHandler: AgentRequestHandler) {
    super();
    this.#spec = spec;
    this.#agentRequestHandler = agentRequestHandler;
  }

  get state(): AcpProcessState {
    return this.#state;
  }

  get recentStderr(): string {
    return this.#stderrBuffer;
  }

  lockRestarts(locked: boolean): void {
    this.#restartsLocked = locked;
  }

  start(): Promise<void> {
    if (this.#starting) return this.#starting;
    this.#starting = this.#start();
    return this.#starting;
  }

  async #start(): Promise<void> {
    this.#setState("starting");
    const child = spawn(this.#spec.command, this.#spec.args, {
      cwd: this.#spec.cwd,
      env: this.#spec.env as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#child = child;

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.#stderrBuffer = `${this.#stderrBuffer}${chunk}`.slice(
        -STDERR_RING_BUFFER_BYTES,
      );
      this.emit("stderr", chunk);
    });

    child.on("exit", (code, signal) => {
      this.#connection?.dispose();
      this.#connection = null;
      this.#child = null;
      this.#starting = null;
      this.emit("exit", { code, signal });
      if (this.#state !== "stopped") {
        this.#setState("crashed");
        this.#maybeRestart();
      }
    });

    this.#connection = new NdjsonRpcConnection(
      child.stdout,
      child.stdin,
      this.#agentRequestHandler,
    );
    this.#connection.on("notification", (method, params) =>
      this.emit("notification", method, params),
    );

    const exited = new Promise<never>((_resolve, reject) => {
      child.once("exit", (code, signal) =>
        reject(
          new Error(
            `ACP process exited before ready (code=${code ?? "null"}, signal=${signal ?? "null"})`,
          ),
        ),
      );
      child.once("error", (error) => reject(error));
    });

    await Promise.race([
      this.#connection.request("initialize", {
        protocolVersion: 1,
        // Deliberately no `fs`/`terminal` client capabilities: unlike the VS
        // Code extension, this client implements neither `fs/*` nor
        // `terminal/*` request handlers, so advertising them would make the
        // core agent delegate file reads/writes and shell execution to a
        // client backend that can't answer — it should keep using its own
        // built-in filesystem and shell tools instead.
        clientCapabilities: {},
        clientInfo: { name: "hooman-desktop", version: "0.1.0" },
      }),
      exited,
    ]);
    this.#restartAttempts = 0;
    this.#setState("ready");
  }

  #maybeRestart(): void {
    if (this.#restartsLocked || this.#restartAttempts >= MAX_RESTART_ATTEMPTS)
      return;
    const delay =
      RESTART_BACKOFF_MS[this.#restartAttempts] ??
      RESTART_BACKOFF_MS[RESTART_BACKOFF_MS.length - 1];
    this.#restartAttempts += 1;
    setTimeout(() => {
      this.#starting = null;
      this.start().catch((error) => this.emit("restartFailed", error));
    }, delay);
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.#connection)
      return Promise.reject(new Error("ACP process not ready"));
    return this.#connection.request<T>(method, params);
  }

  #setState(state: AcpProcessState): void {
    this.#state = state;
    this.emit("stateChanged", state);
  }

  stop(): void {
    this.#setState("stopped");
    this.#child?.kill();
    this.#child = null;
  }
}
