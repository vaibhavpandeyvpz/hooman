import type {
  ContentBlock,
  SessionNotification,
} from "@agentclientprotocol/sdk";
import type { ChannelOrigin } from "../../core/approvals/channel-ask.js";
import type {
  DaemonAcpChildState,
  DaemonDashboardSnapshot,
  DaemonDisposeReason,
  DaemonSessionCard,
} from "./types.js";

const MAX_DISPOSED = 10;
const MAX_DIAGNOSTICS = 300;
const MAX_PREVIEW_LINES = 2;
const MAX_PREVIEW_CHARS = 220;
const NOTIFY_THROTTLE_MS = 90;

function truncatePreview(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_PREVIEW_CHARS) {
    return collapsed;
  }
  return `${collapsed.slice(0, MAX_PREVIEW_CHARS - 1)}\u2026`;
}

/** Keeps only the last `MAX_PREVIEW_LINES` worth of a growing stream preview. */
function appendStreamText(previous: string | undefined, delta: string): string {
  const combined = `${previous ?? ""}${delta}`;
  const lines = combined.split("\n");
  const tail = lines.slice(-MAX_PREVIEW_LINES).join("\n");
  return truncatePreview(tail);
}

function textFromContent(content: ContentBlock): string | null {
  return content.type === "text" ? content.text : null;
}

/**
 * Owns every card the daemon dashboard renders. Fed exclusively through
 * explicit `on*` calls from daemon orchestration, the session registry, the
 * ACP child, and parsed `session/update` notifications — it has no direct
 * dependency on Ink so it can be tested or reused headlessly.
 */
export class DaemonDashboardStore {
  #startedAt = Date.now();
  #channels: string[] = [];
  #mcpServerCount = 0;
  #acpChildState: DaemonAcpChildState = "starting";
  #poolMax = 1;
  #draining = false;
  #cards = new Map<string, DaemonSessionCard>();
  #disposed: DaemonSessionCard[] = [];
  #diagnostics: string[] = [];
  #poolStats = { active: 0, max: 1, waiting: 0 };
  #listeners = new Set<() => void>();
  #notifyTimer: NodeJS.Timeout | null = null;

  public subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #notify(): void {
    if (this.#notifyTimer) {
      return;
    }
    this.#notifyTimer = setTimeout(() => {
      this.#notifyTimer = null;
      for (const listener of this.#listeners) {
        listener();
      }
    }, NOTIFY_THROTTLE_MS);
    this.#notifyTimer.unref?.();
  }

  #card(externalKey: string): DaemonSessionCard {
    const existing = this.#cards.get(externalKey);
    if (existing) {
      return existing;
    }
    const now = Date.now();
    const created: DaemonSessionCard = {
      externalKey,
      origin: null,
      status: "in_progress",
      phase: "queued",
      queueDepth: 1,
      createdAt: now,
      lastActiveAt: now,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
    this.#cards.set(externalKey, created);
    return created;
  }

  public setChannels(channels: string[]): void {
    this.#channels = channels;
    this.#notify();
  }

  public setMcpServerCount(count: number): void {
    this.#mcpServerCount = count;
    this.#notify();
  }

  public setPoolMax(max: number): void {
    this.#poolMax = max;
    this.#poolStats.max = max;
    this.#notify();
  }

  public setAcpChildState(state: DaemonAcpChildState): void {
    this.#acpChildState = state;
    this.#notify();
  }

  public setPoolStats(stats: {
    active: number;
    max: number;
    waiting: number;
  }): void {
    this.#poolStats = stats;
    this.#notify();
  }

  public setDraining(draining: boolean): void {
    this.#draining = draining;
    this.#notify();
  }

  public addDiagnostic(line: string): void {
    this.#diagnostics.push(`[${new Date().toLocaleTimeString()}] ${line}`);
    if (this.#diagnostics.length > MAX_DIAGNOSTICS) {
      this.#diagnostics.splice(0, this.#diagnostics.length - MAX_DIAGNOSTICS);
    }
    this.#notify();
  }

  public onEnqueued(externalKey: string, queueDepth: number): void {
    const card = this.#card(externalKey);
    card.status = "in_progress";
    card.phase = queueDepth > 1 ? "queued" : (card.phase ?? "queued");
    card.queueDepth = queueDepth;
    this.#notify();
  }

  public onWaitingSlot(externalKey: string): void {
    const card = this.#card(externalKey);
    card.status = "in_progress";
    card.phase = "waiting_slot";
    this.#notify();
  }

  public onDequeued(
    externalKey: string,
    userId: string,
    origin: ChannelOrigin | null,
    prompt: string,
    queueDepth: number,
  ): void {
    const card = this.#card(externalKey);
    card.status = "in_progress";
    card.phase = "setting_up";
    card.userId = userId;
    card.origin = origin;
    card.promptPreview = truncatePreview(prompt);
    card.streamPreview = undefined;
    card.toolLabel = undefined;
    card.errorMessage = undefined;
    card.queueDepth = queueDepth;
    card.lastActiveAt = Date.now();
    this.#notify();
  }

  public onSessionReady(externalKey: string, acpSessionId: string): void {
    const card = this.#card(externalKey);
    card.acpSessionId = acpSessionId;
    card.phase = "generating";
    this.#notify();
  }

  public onSessionSetupFailed(externalKey: string, message: string): void {
    const card = this.#card(externalKey);
    card.status = "idle";
    card.phase = undefined;
    card.errorMessage = message;
    card.lastActiveAt = Date.now();
    this.#notify();
  }

  public onPromptFailed(externalKey: string, message: string): void {
    const card = this.#cards.get(externalKey);
    if (card) {
      card.errorMessage = message;
    }
    this.#notify();
  }

  public onIdle(externalKey: string): void {
    const card = this.#cards.get(externalKey);
    if (!card) {
      return;
    }
    card.status = "idle";
    card.phase = undefined;
    card.toolLabel = undefined;
    card.queueDepth = 0;
    card.lastActiveAt = Date.now();
    this.#notify();
  }

  public onDisposed(externalKey: string, reason: DaemonDisposeReason): void {
    const card = this.#cards.get(externalKey);
    if (!card) {
      return;
    }
    this.#cards.delete(externalKey);
    card.status = "disposed";
    card.disposeReason = reason;
    card.disposedAt = Date.now();
    this.#disposed.unshift(card);
    if (this.#disposed.length > MAX_DISPOSED) {
      this.#disposed.length = MAX_DISPOSED;
    }
    this.#notify();
  }

  /** Parses a raw ACP `session/update` payload into card state, keyed by external key. */
  public onAcpUpdate(
    externalKey: string,
    notification: SessionNotification,
  ): void {
    const card = this.#cards.get(externalKey);
    if (!card) {
      return;
    }
    const update = notification.update;
    card.lastActiveAt = Date.now();
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const text = textFromContent(update.content);
        if (text) {
          card.phase = "generating";
          card.toolLabel = undefined;
          card.streamPreview = appendStreamText(card.streamPreview, text);
        }
        break;
      }
      case "agent_thought_chunk": {
        card.phase = "generating";
        break;
      }
      case "tool_call": {
        card.phase = "tool";
        card.toolLabel = `${update.title} \u00b7 running`;
        break;
      }
      case "tool_call_update": {
        card.phase = "tool";
        const status = update.status ?? "in_progress";
        card.toolLabel = `${card.toolLabel?.split(" \u00b7 ")[0] ?? "tool"} \u00b7 ${status}`;
        break;
      }
      case "session_info_update": {
        if (update.title) {
          card.title = update.title;
        }
        break;
      }
      case "usage_update": {
        const meta = notification._meta?.["hoomanjs/tokens"] as
          | {
              input?: number;
              output?: number;
              cacheRead?: number;
              cacheWrite?: number;
              tokensPerSecond?: number;
            }
          | undefined;
        card.usage = {
          inputTokens: meta?.input ?? card.usage.inputTokens,
          outputTokens: meta?.output ?? card.usage.outputTokens,
          cacheReadInputTokens: meta?.cacheRead,
          cacheWriteInputTokens: meta?.cacheWrite,
          tokensPerSecond: meta?.tokensPerSecond,
          contextUsed: update.used,
          contextSize: update.size > 0 ? update.size : undefined,
          costUsd: update.cost?.amount,
        };
        break;
      }
      default:
        break;
    }
    this.#notify();
  }

  public onApprovalWait(externalKey: string): void {
    const card = this.#cards.get(externalKey);
    if (card) {
      card.phase = "approval";
      this.#notify();
    }
  }

  #laneOf(status: "idle" | "in_progress"): DaemonSessionCard[] {
    return [...this.#cards.values()].filter((card) => card.status === status);
  }

  public snapshot(): DaemonDashboardSnapshot {
    const idle = this.#laneOf("idle").sort(
      (a, b) => b.lastActiveAt - a.lastActiveAt,
    );
    const inProgress = this.#laneOf("in_progress").sort(
      (a, b) => a.createdAt - b.createdAt,
    );
    const disposed = [...this.#disposed];

    const allLiveUsage = [...idle, ...inProgress];
    let inputTokens = 0;
    let outputTokens = 0;
    let costUsd = 0;
    let costComplete = allLiveUsage.length > 0;
    for (const card of allLiveUsage) {
      inputTokens += card.usage.inputTokens;
      outputTokens += card.usage.outputTokens;
      if (card.usage.costUsd !== undefined) {
        costUsd += card.usage.costUsd;
      } else {
        costComplete = false;
      }
    }

    return {
      startedAt: this.#startedAt,
      now: Date.now(),
      channels: this.#channels,
      mcpServerCount: this.#mcpServerCount,
      acpChildState: this.#acpChildState,
      poolActive: this.#poolStats.active,
      poolMax: this.#poolStats.max || this.#poolMax,
      poolWaiting: this.#poolStats.waiting,
      totalQueued: inProgress.reduce(
        (sum, card) => sum + Math.max(0, card.queueDepth - 1),
        0,
      ),
      aggregateUsage: { inputTokens, outputTokens, costUsd, costComplete },
      draining: this.#draining,
      idle,
      inProgress,
      disposed,
      diagnostics: this.#diagnostics.slice(-40),
    };
  }
}
