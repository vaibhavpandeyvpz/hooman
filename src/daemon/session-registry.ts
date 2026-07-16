import type { ChannelOrigin } from "../core/approvals/channel-ask.js";
import {
  patchDaemonSessionBinding,
  readDaemonSessionBindings,
  type DaemonSessionBinding,
} from "./session-store.js";

type Runtime = {
  externalKey: string;
  acpSessionId: string;
  cwd: string;
  userId?: string;
  origin: ChannelOrigin | null;
  busy: boolean;
  closing: boolean;
  lastActiveAt: number;
  idleTimer: NodeJS.Timeout | null;
};

type Waiter = { key: string; resolve: () => void };

export type DaemonSessionRegistryOptions = {
  /** Bound on concurrently active ACP sessions. Must be a positive integer. */
  maxActiveSessions: number;
  /** Ordinary idle-close delay after a session becomes non-busy. `0` disables it (pressure eviction still applies). */
  idleTimeoutMs: number;
  /** Called to close an ACP session (idle timeout, pool pressure, or shutdown). Must not throw. */
  onClose: (externalKey: string, acpSessionId: string) => Promise<void>;
};

/**
 * Tracks the daemon's channel-conversation → ACP-session bindings, the
 * durable JSONL mapping, and a bounded pool of concurrently active ACP
 * sessions: idle sessions are evicted LRU under pressure, callers otherwise
 * wait FIFO for a slot, and a non-busy session with pool waiters closes
 * immediately instead of waiting out the ordinary idle timeout.
 */
export class DaemonSessionRegistry {
  #persisted = new Map<string, DaemonSessionBinding>();
  #runtime = new Map<string, Runtime>();
  #reverse = new Map<string, string>();
  #activeKeys = new Set<string>();
  #waiters: Waiter[] = [];
  #shuttingDown = false;

  public constructor(private readonly options: DaemonSessionRegistryOptions) {
    if (
      !Number.isInteger(options.maxActiveSessions) ||
      options.maxActiveSessions < 1
    ) {
      throw new Error("maxActiveSessions must be a positive integer.");
    }
  }

  public async hydrate(): Promise<void> {
    this.#persisted = await readDaemonSessionBindings();
  }

  /** Persisted ACP session ID for a key from a prior daemon run, if any. */
  public persistedAcpSessionId(externalKey: string): string | undefined {
    return this.#persisted.get(externalKey)?.acpSessionId;
  }

  public isActive(externalKey: string): boolean {
    return this.#activeKeys.has(externalKey);
  }

  /** Whether an ACP session is already registered (created/resumed) for `externalKey` in this process. */
  public hasRuntime(externalKey: string): boolean {
    return this.#runtime.has(externalKey);
  }

  public acpSessionIdFor(externalKey: string): string | undefined {
    return this.#runtime.get(externalKey)?.acpSessionId;
  }

  /**
   * Acquires one pool slot for `externalKey`. Reuses the caller's own slot
   * if already held. Otherwise joins the FIFO waiter queue and, if a slot
   * exists, immediately requests one idle LRU session be evicted to make
   * room — but never grants the freed slot directly, so fairness holds even
   * when eviction and waiting happen concurrently.
   */
  public async acquireSlot(externalKey: string): Promise<void> {
    if (this.#activeKeys.has(externalKey)) {
      return;
    }
    if (this.#activeKeys.size < this.options.maxActiveSessions) {
      this.#activeKeys.add(externalKey);
      return;
    }
    const waiterPromise = new Promise<void>((resolve) => {
      this.#waiters.push({ key: externalKey, resolve });
    });
    const idleKey = this.#pickIdleLru();
    if (idleKey) {
      void this.#closeRuntime(idleKey);
    }
    await waiterPromise;
  }

  /** Registers a newly created/resumed active session and marks it busy for the in-flight turn. */
  public registerActive(binding: {
    externalKey: string;
    acpSessionId: string;
    cwd: string;
    userId?: string;
    origin: ChannelOrigin | null;
  }): void {
    this.#runtime.set(binding.externalKey, {
      externalKey: binding.externalKey,
      acpSessionId: binding.acpSessionId,
      cwd: binding.cwd,
      userId: binding.userId,
      origin: binding.origin,
      busy: true,
      closing: false,
      lastActiveAt: Date.now(),
      idleTimer: null,
    });
    this.#reverse.set(binding.acpSessionId, binding.externalKey);
  }

  /** Persists the external-key → ACP-session-ID binding (create, or replacement after a missing-session resume failure). */
  public async persistBinding(params: {
    externalKey: string;
    acpSessionId: string;
    cwd: string;
    userId?: string | null;
  }): Promise<void> {
    const now = new Date().toISOString();
    const existing = this.#persisted.get(params.externalKey);
    const entry: DaemonSessionBinding = {
      externalKey: params.externalKey,
      acpSessionId: params.acpSessionId,
      cwd: params.cwd,
      userId: params.userId ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.#persisted.set(params.externalKey, entry);
    await patchDaemonSessionBinding(entry);
  }

  public updateOrigin(externalKey: string, origin: ChannelOrigin | null): void {
    const runtime = this.#runtime.get(externalKey);
    if (runtime) {
      runtime.origin = origin;
    }
  }

  public originForAcpSession(acpSessionId: string): ChannelOrigin | null {
    const key = this.#reverse.get(acpSessionId);
    if (!key) {
      return null;
    }
    return this.#runtime.get(key)?.origin ?? null;
  }

  public externalKeyForAcpSession(acpSessionId: string): string | undefined {
    return this.#reverse.get(acpSessionId);
  }

  /** Marks a session busy for the duration of one `session/prompt` call, cancelling any armed idle timer. */
  public markBusy(externalKey: string): void {
    const runtime = this.#runtime.get(externalKey);
    if (!runtime) {
      return;
    }
    runtime.busy = true;
    if (runtime.idleTimer) {
      clearTimeout(runtime.idleTimer);
      runtime.idleTimer = null;
    }
  }

  /**
   * Marks a session non-busy after its turn settles. When more work for the
   * same key is already queued, the caller keeps its slot untouched. When
   * pool waiters exist, the session closes immediately instead of arming the
   * ordinary idle timer.
   */
  public markIdle(externalKey: string, hasQueuedWork: boolean): void {
    const runtime = this.#runtime.get(externalKey);
    if (!runtime || runtime.closing) {
      return;
    }
    runtime.busy = false;
    runtime.lastActiveAt = Date.now();
    if (hasQueuedWork) {
      return;
    }
    if (this.#waiters.length > 0) {
      void this.#closeRuntime(externalKey);
      return;
    }
    if (this.options.idleTimeoutMs > 0) {
      runtime.idleTimer = setTimeout(() => {
        runtime.idleTimer = null;
        if (!runtime.busy && !runtime.closing) {
          void this.#closeRuntime(externalKey);
        }
      }, this.options.idleTimeoutMs);
      runtime.idleTimer.unref?.();
    }
  }

  #pickIdleLru(): string | undefined {
    let best: Runtime | undefined;
    for (const runtime of this.#runtime.values()) {
      if (runtime.busy || runtime.closing) {
        continue;
      }
      if (!best || runtime.lastActiveAt < best.lastActiveAt) {
        best = runtime;
      }
    }
    return best?.externalKey;
  }

  async #closeRuntime(externalKey: string): Promise<void> {
    const runtime = this.#runtime.get(externalKey);
    if (!runtime || runtime.closing) {
      return;
    }
    runtime.closing = true;
    if (runtime.idleTimer) {
      clearTimeout(runtime.idleTimer);
      runtime.idleTimer = null;
    }
    await this.options.onClose(externalKey, runtime.acpSessionId);
    this.#runtime.delete(externalKey);
    this.#reverse.delete(runtime.acpSessionId);
    this.#activeKeys.delete(externalKey);
    const waiter = this.#waiters.shift();
    if (waiter) {
      this.#activeKeys.add(waiter.key);
      waiter.resolve();
    }
  }

  /** Rejects queued waiters, closes every active session, and stops granting new slots. */
  public async shutdown(): Promise<void> {
    this.#shuttingDown = true;
    const pending = this.#waiters.splice(0, this.#waiters.length);
    for (const waiter of pending) {
      waiter.resolve();
    }
    await Promise.all(
      [...this.#runtime.keys()].map((key) => this.#closeRuntime(key)),
    );
  }

  public get isShuttingDown(): boolean {
    return this.#shuttingDown;
  }
}
