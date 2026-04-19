import {
  AfterInvocationEvent,
  BeforeInvocationEvent,
  Message,
  type LocalAgent,
  type MessageData,
  type Plugin,
  type Snapshot,
  type SnapshotLocation,
  type SnapshotStorage,
} from "@strands-agents/sdk";

const DEFAULT_SESSION_ID = "default-session";
const DEFAULT_APP_STATE_KEY = "sessionId";
const DEFAULT_SCOPE_ID = "agent";
const SCHEMA_VERSION = "1.0";
// `FileStorage` (and any backend that follows its convention) validates ids
// against `[a-z0-9_-]+`, so coerce anything else (e.g. `919599960600@c.us`).
const UNSAFE_CHARS = /[^a-z0-9_-]+/g;

export type LazySessionManagerConfig = {
  /** Pluggable snapshot backend (e.g. `FileStorage`). */
  storage: SnapshotStorage;
  /** Fallback session id when `appState` does not provide one. Defaults to `"default-session"`. */
  defaultSessionId?: string;
  /** `appState` key used to derive the active session id. Defaults to `"sessionId"`. */
  appStateKey?: string;
  /** Scope id passed through to the storage backend. Defaults to `"agent"`. */
  scopeId?: string;
};

/**
 * Short-term memory plugin that resolves the active session id at invocation
 * time from `agent.appState` instead of binding it once at construction.
 *
 * Designed for long-lived agents that fan out to many independent
 * conversations (e.g. a daemon routing notifications from multiple chat
 * channels). Persistence is delegated to a `SnapshotStorage` so any backend
 * (filesystem, S3, custom) works.
 */
export class LazySessionManager implements Plugin {
  private readonly storage: SnapshotStorage;
  private readonly defaultSessionId: string;
  private readonly appStateKey: string;
  private readonly scopeId: string;

  constructor(config: LazySessionManagerConfig) {
    this.storage = config.storage;
    this.defaultSessionId = sanitize(
      config.defaultSessionId ?? DEFAULT_SESSION_ID,
    );
    this.appStateKey = config.appStateKey ?? DEFAULT_APP_STATE_KEY;
    this.scopeId = sanitize(config.scopeId ?? DEFAULT_SCOPE_ID);
  }

  get name(): string {
    return "hooman:lazy-session-manager";
  }

  initAgent(agent: LocalAgent): void {
    agent.addHook(BeforeInvocationEvent, async (event) => {
      await this.restore(event.agent);
    });
    agent.addHook(AfterInvocationEvent, async (event) => {
      await this.save(event.agent);
    });
  }

  /** Removes the persisted history for the given session, if present. */
  async deleteSession(sessionId: string): Promise<void> {
    await this.storage.deleteSession({ sessionId: sanitize(sessionId) });
  }

  private location(agent: LocalAgent): SnapshotLocation {
    return {
      sessionId: sanitize(this.resolveSessionId(agent)),
      scope: "agent",
      scopeId: this.scopeId,
    };
  }

  private resolveSessionId(agent: LocalAgent): string {
    const raw = agent.appState.get(this.appStateKey);
    const candidate = typeof raw === "string" ? raw.trim() : "";
    return candidate.length > 0 ? candidate : this.defaultSessionId;
  }

  private async restore(agent: LocalAgent): Promise<void> {
    const snapshot = await this.storage.loadSnapshot({
      location: this.location(agent),
    });
    agent.messages.length = 0;
    if (!snapshot) return;
    const raw = snapshot.data.messages;
    if (!Array.isArray(raw)) return;
    for (const md of raw as unknown as MessageData[]) {
      agent.messages.push(Message.fromJSON(md));
    }
  }

  private async save(agent: LocalAgent): Promise<void> {
    const messages = agent.messages.map((m) => m.toJSON());
    const snapshot: Snapshot = {
      scope: "agent",
      schemaVersion: SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      data: { messages: messages as unknown as Snapshot["data"]["messages"] },
      appData: {},
    };
    await this.storage.saveSnapshot({
      location: this.location(agent),
      snapshotId: "latest",
      isLatest: true,
      snapshot,
    });
  }
}

function sanitize(value: string): string {
  const trimmed = value.trim().toLowerCase().replace(UNSAFE_CHARS, "_");
  return trimmed.length > 0 ? trimmed : DEFAULT_SESSION_ID;
}
