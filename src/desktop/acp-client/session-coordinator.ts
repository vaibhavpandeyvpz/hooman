import type {
  PromptContentBlock,
  SessionConfigOption,
  SessionNotification,
} from "../shared/session-types.js";
import type { AcpProcessSupervisor } from "./process-supervisor.js";

type QueueEntry = {
  prompt: PromptContentBlock[];
  resolve: () => void;
  reject: (error: Error) => void;
};

/**
 * Per-project session bookkeeping on top of one `AcpProcessSupervisor`:
 * session creation, per-session prompt serialization (ACP requires a single
 * in-flight `session/prompt` per session), and notification fan-out.
 */
export class SessionCoordinator {
  #supervisor: AcpProcessSupervisor;
  #queues = new Map<string, QueueEntry[]>();
  #busy = new Set<string>();
  #listeners = new Map<
    string,
    Set<(notification: SessionNotification) => void>
  >();

  constructor(supervisor: AcpProcessSupervisor) {
    this.#supervisor = supervisor;
    supervisor.on("notification", (method: string, params: unknown) => {
      if (method !== "session/update") return;
      const notification = params as SessionNotification;
      for (const listener of this.#listeners.get(notification.sessionId) ??
        []) {
        listener(notification);
      }
    });
  }

  onSessionUpdate(
    sessionId: string,
    listener: (notification: SessionNotification) => void,
  ): () => void {
    const set = this.#listeners.get(sessionId) ?? new Set();
    set.add(listener);
    this.#listeners.set(sessionId, set);
    return () => set.delete(listener);
  }

  async createSession(
    cwd: string,
  ): Promise<{ sessionId: string; configOptions?: SessionConfigOption[] }> {
    return this.#supervisor.request("session/new", { cwd, mcpServers: [] });
  }

  /**
   * `session/load` returns the session's initial config options too — same
   * shape as `session/new`. `cwd` and `mcpServers` are required by the ACP
   * schema even though this project only ever loads a session for its own
   * (already-known) cwd.
   */
  async loadSession(
    cwd: string,
    sessionId: string,
  ): Promise<{ configOptions?: SessionConfigOption[] }> {
    return this.#supervisor.request("session/load", {
      sessionId,
      cwd,
      mcpServers: [],
    });
  }

  /** Serializes prompts per session; concurrent calls for the same session queue in order. */
  prompt(sessionId: string, prompt: PromptContentBlock[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const queue = this.#queues.get(sessionId) ?? [];
      queue.push({ prompt, resolve: () => resolve(undefined), reject });
      this.#queues.set(sessionId, queue);
      void this.#drain(sessionId);
    });
  }

  async #drain(sessionId: string): Promise<void> {
    if (this.#busy.has(sessionId)) return;
    const queue = this.#queues.get(sessionId);
    const next = queue?.shift();
    if (!next) return;
    this.#busy.add(sessionId);
    try {
      await this.#supervisor.request("session/prompt", {
        sessionId,
        prompt: next.prompt,
      });
      next.resolve();
    } catch (error) {
      next.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.#busy.delete(sessionId);
      void this.#drain(sessionId);
    }
  }

  async cancel(sessionId: string): Promise<void> {
    await this.#supervisor.request("session/cancel", { sessionId });
  }

  /** Custom `_hoomanjs/stop_shell_job`: kill a background shell job by id. */
  async stopShellJob(
    sessionId: string,
    jobId: string,
  ): Promise<{ stopped: boolean }> {
    return this.#supervisor.request("_hoomanjs/stop_shell_job", {
      sessionId,
      jobId,
    });
  }

  /**
   * `SetSessionConfigOptionRequest` is a discriminated union: boolean options
   * require an explicit `type: "boolean"` alongside a real boolean `value`;
   * every other (select) option sends its value as a plain string, with no
   * `type` field at all.
   */
  async setConfigOption(
    sessionId: string,
    configId: string,
    value: string | boolean,
  ): Promise<{ configOptions: SessionConfigOption[] }> {
    return this.#supervisor.request(
      "session/set_config_option",
      typeof value === "boolean"
        ? { sessionId, configId, type: "boolean", value }
        : { sessionId, configId, value },
    );
  }

  async listSessions(cwd: string): Promise<{
    sessions: Array<{ sessionId: string; title?: string; updatedAt: string }>;
  }> {
    return this.#supervisor.request("session/list", { cwd });
  }

  async closeSession(sessionId: string): Promise<void> {
    this.#queues.delete(sessionId);
    this.#busy.delete(sessionId);
    this.#listeners.delete(sessionId);
    await this.#supervisor.request("session/close", { sessionId });
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.#queues.delete(sessionId);
    this.#busy.delete(sessionId);
    this.#listeners.delete(sessionId);
    await this.#supervisor.request("session/delete", { sessionId });
  }
}
