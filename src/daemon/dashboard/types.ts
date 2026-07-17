import type { ChannelOrigin } from "../../core/approvals/channel-ask.js";
import type { DaemonDisposeReason } from "../session-registry.js";

export type { DaemonDisposeReason };

/** Which lane a card currently belongs to. */
export type DaemonLaneStatus = "idle" | "in_progress" | "disposed";

/** Fine-grained activity while a card is in the "in_progress" lane. */
export type DaemonTurnPhase =
  | "queued"
  | "waiting_slot"
  | "setting_up"
  | "generating"
  | "tool"
  | "approval"
  | "draining";

export type DaemonCardUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
  tokensPerSecond?: number;
  contextUsed?: number;
  contextSize?: number;
  costUsd?: number;
};

export type DaemonSessionCard = {
  externalKey: string;
  acpSessionId?: string;
  title?: string;
  userId?: string;
  origin: ChannelOrigin | null;
  status: DaemonLaneStatus;
  phase?: DaemonTurnPhase;
  toolLabel?: string;
  queueDepth: number;
  promptPreview?: string;
  streamPreview?: string;
  errorMessage?: string;
  disposeReason?: DaemonDisposeReason;
  createdAt: number;
  lastActiveAt: number;
  disposedAt?: number;
  usage: DaemonCardUsage;
};

export type DaemonAcpChildState =
  "starting" | "connected" | "reconnecting" | "stopped";

export type DaemonDashboardSnapshot = {
  startedAt: number;
  now: number;
  channels: string[];
  mcpServerCount: number;
  acpChildState: DaemonAcpChildState;
  poolActive: number;
  poolMax: number;
  poolWaiting: number;
  totalQueued: number;
  aggregateUsage: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    /** Whether cost is fully priced across every card contributing to it. */
    costComplete: boolean;
  };
  draining: boolean;
  idle: DaemonSessionCard[];
  inProgress: DaemonSessionCard[];
  disposed: DaemonSessionCard[];
  diagnostics: string[];
};
