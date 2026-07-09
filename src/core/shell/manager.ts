import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import {
  getTerminalBackend,
  type TerminalBackend,
} from "./terminal-backend.js";
import { OutputBuffer } from "./output-buffer.js";
import type {
  ShellJobEvent,
  ShellJobInfo,
  ShellJobListener,
  ShellJobOutputSnapshot,
  ShellJobStartOptions,
  ShellJobStatus,
  ShellJobWaitOptions,
} from "./types.js";

const SIGKILL_TIMEOUT_MS = 200;
const PORT_PROBE_INTERVAL_MS = 250;
const DEFAULT_READY_TIMEOUT_MS = 30_000;
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const ACTIVE_STATUSES = new Set<ShellJobStatus>([
  "starting",
  "running",
  "ready",
]);

type InternalJob = {
  info: ShellJobInfo;
  buffer: OutputBuffer;
  child?: ChildProcess;
  terminalId?: string;
  backend?: TerminalBackend;
  exited: boolean;
  /** Offset into buffer text already consumed by pattern waits. */
  readOffset: number;
  /** Resolvers waiting for exit. */
  exitWaiters: Array<() => void>;
  /** Resolvers waiting for a pattern match or ready. */
  patternWaiters: Array<{
    regex: RegExp;
    since: number;
    resolve: (matched: boolean) => void;
  }>;
  pollTimer?: ReturnType<typeof setInterval>;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  portProbeTimer?: ReturnType<typeof setInterval>;
  /** True while a host output sync RPC is in flight (prevents poll pile-up). */
  syncInFlight: boolean;
  readyPattern?: RegExp;
  readyPort?: number;
  notifyPattern?: RegExp;
  notifyDebounceMs: number;
  lastNotifyCheckAt: number;
  watchdogFired: boolean;
  /** User/agent requested stop — exit should be reported as stopped, not completed. */
  stopRequested: boolean;
};

function newJobId(): string {
  return `job-${randomBytes(4).toString("hex")}`;
}

function compileRegex(pattern: string): RegExp {
  return new RegExp(pattern, "m");
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

function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * Session-scoped manager for background (and early-return) shell jobs.
 * Local spawn uses child_process; when a TerminalBackend with `spawn` is
 * registered, jobs are hosted by the ACP client instead.
 */
export class ShellJobManager {
  readonly #jobs = new Map<string, InternalJob>();
  readonly #listeners = new Set<ShellJobListener>();
  readonly #agent: object;

  constructor(agent: object) {
    this.#agent = agent;
  }

  on(listener: ShellJobListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  list(): ShellJobInfo[] {
    return [...this.#jobs.values()].map((j) => ({ ...j.info }));
  }

  listActive(): ShellJobInfo[] {
    return this.list().filter((j) => ACTIVE_STATUSES.has(j.status));
  }

  get(jobId: string): ShellJobInfo | undefined {
    const job = this.#jobs.get(jobId);
    return job ? { ...job.info } : undefined;
  }

  /**
   * Start a job. Returns a snapshot once the block condition is met
   * (immediate BG, notify/ready match, block_until deadline, or exit).
   */
  async start(options: ShellJobStartOptions): Promise<ShellJobOutputSnapshot> {
    const id = newJobId();
    const backend = getTerminalBackend(this.#agent);
    const useHost = Boolean(backend?.spawn);

    const info: ShellJobInfo = {
      id,
      description: options.description,
      command: [options.command, ...options.args].join(" "),
      cwd: options.cwd,
      status: "starting",
      ready: false,
      toolUseId: options.toolUseId,
      exitCode: null,
      signal: null,
      startedAt: Date.now(),
      outputTruncated: false,
    };

    const job: InternalJob = {
      info,
      buffer: new OutputBuffer(id, {
        onWatchdog: () => {
          if (!job.watchdogFired) {
            job.watchdogFired = true;
            void this.stop(id);
          }
        },
      }),
      exited: false,
      readOffset: 0,
      exitWaiters: [],
      patternWaiters: [],
      notifyDebounceMs: options.notifyOnOutput?.debounce_ms ?? 0,
      lastNotifyCheckAt: 0,
      watchdogFired: false,
      stopRequested: false,
      syncInFlight: false,
      backend: useHost ? backend : undefined,
    };

    if (options.notifyOnOutput?.pattern) {
      job.notifyPattern = compileRegex(options.notifyOnOutput.pattern);
    }
    if (options.ready?.pattern) {
      job.readyPattern = compileRegex(options.ready.pattern);
    }
    if (options.ready?.port !== undefined) {
      job.readyPort = options.ready.port;
    }

    this.#jobs.set(id, job);
    this.#emit({ type: "started", job: { ...info } });

    try {
      if (useHost && backend?.spawn) {
        await this.#startHost(job, options, backend);
      } else {
        this.#startLocal(job, options);
      }
    } catch (error) {
      job.info.status = "failed";
      job.info.endedAt = Date.now();
      job.exited = true;
      const message = error instanceof Error ? error.message : String(error);
      this.#emit({ type: "failed", job: { ...job.info }, error: message });
      return this.#snapshot(job);
    }

    job.info.status = "running";

    if (options.timeoutMs && options.timeoutMs > 0) {
      job.timeoutTimer = setTimeout(() => {
        void this.stop(id);
      }, options.timeoutMs);
    }

    if (job.readyPort !== undefined) {
      this.#startPortProbe(job, options.ready?.timeout_ms);
    }

    // Immediate background: block_until_ms === 0 and no notify/ready wait.
    const blockUntil =
      options.blockUntilMs !== undefined
        ? options.blockUntilMs
        : options.notifyOnOutput || options.ready
          ? (options.ready?.timeout_ms ?? DEFAULT_READY_TIMEOUT_MS)
          : undefined;

    if (blockUntil === 0) {
      return this.#snapshot(job);
    }

    // Foreground-style wait for exit when no early-return condition.
    if (blockUntil === undefined && !options.notifyOnOutput && !options.ready) {
      await this.#waitForExit(job, options.cancelSignal);
      return this.#snapshot(job);
    }

    // Wait for notify/ready or deadline, then return while process continues.
    const deadline = blockUntil ?? DEFAULT_READY_TIMEOUT_MS;
    await this.#waitForEarlyReturn(job, deadline, options.cancelSignal);
    return this.#snapshot(job);
  }

  async output(
    jobId: string,
    opts?: ShellJobWaitOptions,
  ): Promise<ShellJobOutputSnapshot> {
    const job = this.#require(jobId);
    await this.#syncHostOutput(job);

    const block = opts?.block ?? true;
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    const pattern = opts?.pattern ? compileRegex(opts.pattern) : undefined;

    if (!block && !pattern) {
      return this.#snapshot(job, opts?.tailLines);
    }

    if (pattern) {
      const since = job.readOffset;
      const matched = await this.#waitForPattern(
        job,
        pattern,
        since,
        timeoutMs,
        opts?.cancelSignal,
      );
      const snap = this.#snapshot(job, opts?.tailLines);
      snap.matched = matched;
      job.readOffset = job.buffer.readAll().length;
      return snap;
    }

    // Block until exit.
    if (ACTIVE_STATUSES.has(job.info.status)) {
      await Promise.race([
        this.#waitForExit(job, opts?.cancelSignal),
        sleep(timeoutMs).then(() => undefined),
      ]);
      await this.#syncHostOutput(job);
    }
    return this.#snapshot(job, opts?.tailLines);
  }

  async stop(jobId: string): Promise<ShellJobOutputSnapshot> {
    const job = this.#require(jobId);
    job.stopRequested = true;
    // Stop polling before kill so we don't pile terminal/output RPCs on top
    // of the kill path (chatty jobs like `top` make that expensive).
    this.#clearTimers(job);

    if (job.info.status === "stopped") {
      return this.#snapshot(job);
    }

    // Kill the host/local process. Under ACP this nests `terminal/kill` under
    // the caller (stop_shell_job / shell_stop) — same concurrent-request
    // pattern as terminal/* during session/prompt.
    if (ACTIVE_STATUSES.has(job.info.status) || !job.exited) {
      if (job.terminalId && job.backend?.kill) {
        await job.backend.kill(job.terminalId).catch(() => undefined);
      } else if (job.child) {
        await killTree(job.child, { exited: () => job.exited });
      }
    }

    if (!job.exited) {
      this.#markEnded(job, "stopped", null, null);
    } else if (job.info.status === "completed") {
      job.info.status = "stopped";
      this.#emit({ type: "stopped", job: { ...job.info } });
    }
    return this.#snapshot(job);
  }

  /** Kill all active jobs (session teardown). */
  async clear(): Promise<void> {
    const ids = [...this.#jobs.keys()];
    await Promise.all(ids.map((id) => this.stop(id).catch(() => undefined)));
    for (const job of this.#jobs.values()) {
      this.#clearTimers(job);
    }
    this.#jobs.clear();
    this.#listeners.clear();
  }

  #require(jobId: string): InternalJob {
    const job = this.#jobs.get(jobId);
    if (!job) {
      throw new Error(`Unknown shell job "${jobId}"`);
    }
    return job;
  }

  #snapshot(job: InternalJob, tailLines?: number): ShellJobOutputSnapshot {
    job.info.outputTruncated = job.buffer.truncated;
    const output =
      tailLines !== undefined
        ? job.buffer.readTailLines(tailLines)
        : job.buffer.readTail();
    return {
      jobId: job.info.id,
      output,
      truncated: job.buffer.truncated,
      status: job.info.status,
      ready: job.info.ready,
      exitCode: job.info.exitCode,
      signal: job.info.signal,
    };
  }

  #emit(event: ShellJobEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // Listeners must not break the manager.
      }
    }
  }

  #startLocal(job: InternalJob, options: ShellJobStartOptions): void {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: process.env,
      detached: process.platform !== "win32",
      stdio: "pipe",
      windowsHide: true,
    });
    job.child = child;
    job.info.pid = child.pid;

    const onData = (chunk: Buffer | string) => {
      this.#appendOutput(job, chunk.toString());
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    child.stdin?.end();

    child.once("error", (error) => {
      this.#appendOutput(job, `\n${error.message}`);
      this.#markEnded(job, "failed", 1, null);
    });

    child.once("close", (code, signal) => {
      const status = job.stopRequested ? "stopped" : "completed";
      this.#markEnded(job, status, code, signal ? String(signal) : null);
    });

    // Foreground-only: turn cancellation must not kill background jobs.
    const detachAsBackground =
      options.blockUntilMs === 0 ||
      options.notifyOnOutput !== undefined ||
      options.ready !== undefined;
    if (options.cancelSignal && !detachAsBackground) {
      const onAbort = () => {
        void this.stop(job.info.id);
      };
      if (options.cancelSignal.aborted) {
        onAbort();
      } else {
        options.cancelSignal.addEventListener("abort", onAbort, { once: true });
      }
    }
  }

  async #startHost(
    job: InternalJob,
    options: ShellJobStartOptions,
    backend: TerminalBackend,
  ): Promise<void> {
    const spawned = await backend.spawn!({
      toolUseId: options.toolUseId,
      command: options.command,
      args: options.args,
      cwd: options.cwd,
      timeoutMs: options.timeoutMs ?? 0,
      outputByteLimit: options.outputByteLimit,
      cancelSignal: options.cancelSignal,
      jobId: job.info.id,
    });
    job.terminalId = spawned.terminalId;
    job.info.terminalId = spawned.terminalId;

    // Poll host output while the job is active.
    job.pollTimer = setInterval(() => {
      void this.#syncHostOutput(job);
    }, 300);
  }

  async #syncHostOutput(job: InternalJob): Promise<void> {
    if (!job.terminalId || !job.backend?.readOutput || job.syncInFlight) {
      return;
    }
    job.syncInFlight = true;
    try {
      const snap = await job.backend.readOutput(job.terminalId);
      const current = job.buffer.readAll();
      if (snap.output.length > current.length) {
        this.#appendOutput(job, snap.output.slice(current.length));
      } else if (snap.output !== current && snap.output.length > 0) {
        // Host may have truncated from the front; replace buffer content.
        // Append only the delta suffix if possible.
        const idx = snap.output.indexOf(current.slice(-200));
        if (idx >= 0) {
          this.#appendOutput(job, snap.output.slice(idx + 200));
        }
      }
      if (snap.exitCode !== null || snap.signal !== null) {
        if (!job.exited) {
          const status = job.stopRequested ? "stopped" : "completed";
          this.#markEnded(job, status, snap.exitCode, snap.signal);
        }
      }
    } catch {
      // Host may have released the terminal.
    } finally {
      job.syncInFlight = false;
    }
  }

  #appendOutput(job: InternalJob, chunk: string): void {
    if (!chunk) {
      return;
    }
    job.buffer.append(chunk);
    this.#emit({ type: "output", job: { ...job.info }, chunk });
    this.#checkPatterns(job);
  }

  #checkPatterns(job: InternalJob): void {
    const text = job.buffer.readAll();

    if (!job.info.ready && job.readyPattern && job.readyPattern.test(text)) {
      this.#markReady(job);
    }

    if (job.notifyPattern) {
      const now = Date.now();
      if (now - job.lastNotifyCheckAt >= job.notifyDebounceMs) {
        job.lastNotifyCheckAt = now;
        if (job.notifyPattern.test(text)) {
          for (const waiter of job.patternWaiters.splice(0)) {
            if (waiter.regex === job.notifyPattern || waiter.regex.test(text)) {
              waiter.resolve(true);
            } else {
              job.patternWaiters.push(waiter);
            }
          }
        }
      }
    }

    const remaining: typeof job.patternWaiters = [];
    for (const waiter of job.patternWaiters) {
      const slice = text.slice(waiter.since);
      if (waiter.regex.test(slice) || waiter.regex.test(text)) {
        waiter.resolve(true);
      } else {
        remaining.push(waiter);
      }
    }
    job.patternWaiters = remaining;
  }

  #markReady(job: InternalJob): void {
    if (job.info.ready) {
      return;
    }
    job.info.ready = true;
    if (job.info.status === "running" || job.info.status === "starting") {
      job.info.status = "ready";
    }
    this.#clearPortProbe(job);
    this.#emit({ type: "ready", job: { ...job.info } });
    // Resolve pattern waiters that were waiting for ready.
    for (const waiter of job.patternWaiters.splice(0)) {
      waiter.resolve(true);
    }
  }

  #startPortProbe(job: InternalJob, readyTimeoutMs?: number): void {
    const port = job.readyPort;
    if (port === undefined) {
      return;
    }
    const deadline = Date.now() + (readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS);
    job.portProbeTimer = setInterval(() => {
      if (job.info.ready || job.exited || Date.now() > deadline) {
        this.#clearPortProbe(job);
        return;
      }
      void probePort(port).then((ok) => {
        if (ok && !job.info.ready && !job.exited) {
          this.#markReady(job);
        }
      });
    }, PORT_PROBE_INTERVAL_MS);
  }

  #clearPortProbe(job: InternalJob): void {
    if (job.portProbeTimer) {
      clearInterval(job.portProbeTimer);
      job.portProbeTimer = undefined;
    }
  }

  #clearTimers(job: InternalJob): void {
    if (job.pollTimer) {
      clearInterval(job.pollTimer);
      job.pollTimer = undefined;
    }
    if (job.timeoutTimer) {
      clearTimeout(job.timeoutTimer);
      job.timeoutTimer = undefined;
    }
    this.#clearPortProbe(job);
  }

  #markEnded(
    job: InternalJob,
    status: "completed" | "stopped" | "failed",
    exitCode: number | null,
    signal: string | null,
  ): void {
    if (job.exited && job.info.status !== "starting") {
      // Already ended; allow stop to override completed → stopped.
      if (!(status === "stopped" && job.info.status === "completed")) {
        return;
      }
    }
    job.exited = true;
    job.info.status = status;
    job.info.exitCode = exitCode;
    job.info.signal = signal;
    job.info.endedAt = Date.now();
    this.#clearTimers(job);

    for (const waiter of job.exitWaiters.splice(0)) {
      waiter();
    }
    for (const waiter of job.patternWaiters.splice(0)) {
      waiter.resolve(false);
    }

    if (status === "stopped") {
      this.#emit({ type: "stopped", job: { ...job.info } });
    } else if (status === "failed") {
      this.#emit({
        type: "failed",
        job: { ...job.info },
        error: "process failed",
      });
    } else {
      this.#emit({ type: "completed", job: { ...job.info } });
    }
  }

  #waitForExit(job: InternalJob, cancelSignal?: AbortSignal): Promise<void> {
    if (job.exited) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      job.exitWaiters.push(resolve);
      if (cancelSignal) {
        const onAbort = () => {
          void this.stop(job.info.id).finally(resolve);
        };
        if (cancelSignal.aborted) {
          onAbort();
        } else {
          cancelSignal.addEventListener("abort", onAbort, { once: true });
        }
      }
    });
  }

  #waitForPattern(
    job: InternalJob,
    regex: RegExp,
    since: number,
    timeoutMs: number,
    cancelSignal?: AbortSignal,
  ): Promise<boolean> {
    const text = job.buffer.readAll();
    if (regex.test(text.slice(since)) || regex.test(text)) {
      return Promise.resolve(true);
    }
    if (job.exited) {
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      let settled = false;
      const settle = (matched: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(matched);
      };

      job.patternWaiters.push({ regex, since, resolve: settle });

      const timer = setTimeout(() => settle(false), timeoutMs);

      if (cancelSignal) {
        const onAbort = () => settle(false);
        if (cancelSignal.aborted) {
          onAbort();
        } else {
          cancelSignal.addEventListener("abort", onAbort, { once: true });
        }
      }
    });
  }

  async #waitForEarlyReturn(
    job: InternalJob,
    deadlineMs: number,
    cancelSignal?: AbortSignal,
  ): Promise<void> {
    if (job.exited || job.info.ready) {
      return;
    }

    const patterns: RegExp[] = [];
    if (job.notifyPattern) {
      patterns.push(job.notifyPattern);
    }
    if (job.readyPattern) {
      patterns.push(job.readyPattern);
    }

    if (patterns.length === 0 && job.readyPort === undefined) {
      // Just wait for the deadline, then detach.
      await Promise.race([
        this.#waitForExit(job, cancelSignal),
        sleep(deadlineMs),
      ]);
      return;
    }

    const since = 0;
    const waiters = patterns.map((regex) =>
      this.#waitForPattern(job, regex, since, deadlineMs, cancelSignal),
    );

    // Also resolve early when ready via port.
    const readyWait =
      job.readyPort !== undefined
        ? new Promise<boolean>((resolve) => {
            const check = () => {
              if (job.info.ready) {
                resolve(true);
                return;
              }
              if (job.exited) {
                resolve(false);
                return;
              }
              setTimeout(check, 100);
            };
            check();
            setTimeout(() => resolve(job.info.ready), deadlineMs);
          })
        : null;

    await Promise.race([
      ...waiters,
      ...(readyWait ? [readyWait] : []),
      this.#waitForExit(job, cancelSignal),
      sleep(deadlineMs),
    ]);
  }
}
