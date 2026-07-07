import type {
  PermissionOptionKind,
  SessionConfigOption,
  SessionUpdate,
} from "@agentclientprotocol/sdk";
import type {
  ConfigEditorAction,
  ConfigEditorStateInfo,
  InstructionsEditorAction,
  InstructionsEditorStateInfo,
  McpEditorAction,
  McpEditorStateInfo,
  SkillsViewAction,
  SkillsViewStateInfo,
} from "./settings";

/**
 * Bridge protocol between the extension host (`src/chat-view.ts`) and the
 * SolidJS webview app (`webview/main.tsx`). Kept as a standalone, JSX-free
 * module under the host's `src/` tree so it's covered by the host tsconfig
 * (`tsconfig.json`, `include: ["src/**\/*.ts", ...]`) while the webview
 * tsconfig (`tsconfig.webview.json`) references it by relative path.
 */

export interface CommandInfo {
  name: string;
  description?: string;
}

export interface EditInfo {
  path: string;
  name: string;
  created: boolean;
  adds: number;
  removes: number;
}

export interface PermissionOptionInfo {
  optionId: string;
  name: string;
  kind?: PermissionOptionKind;
}

/** Cumulative session token totals (billing meter), forwarded via `usage_update._meta`. */
export interface TokenTotals {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** Output tokens/sec over the latest request's generation window. */
  tokensPerSecond?: number;
}

/**
 * Context-window utilization from `usage_update`: tokens currently in context
 * vs. the window size resolved from the model's billing config / models.dev
 * (the agent sends `size: 0` when unresolved, in which case this stays unset).
 */
export interface ContextUsageInfo {
  used: number;
  size: number;
}

/** Cumulative session cost from `usage_update.cost` (omitted when pricing was unresolved). */
export interface CostInfo {
  amount: number;
  currency: string;
}

/**
 * Live model-weights download progress (llama.cpp GGUF fetched from the
 * Hugging Face Hub on first use), forwarded by the agent as a custom
 * `_hoomanjs/model_download` notification during a prompt turn.
 */
export interface ModelDownloadInfo {
  status: "downloading" | "done" | "error";
  /** Configured model spec, e.g. `unsloth/gemma-4-E2B-it-GGUF:Q4_K_M`. */
  model: string;
  /** Basename of the file being downloaded. */
  file: string;
  /** Set for sharded GGUFs (downloaded and reported one at a time). */
  shard?: { index: number; total: number };
  receivedBytes: number;
  totalBytes?: number;
  bytesPerSecond?: number;
  etaSeconds?: number;
  error?: string;
}

/** `_hoomanjs/model_download` notification params: progress plus the owning session. */
export interface ModelDownloadNotification extends ModelDownloadInfo {
  sessionId: string;
}

export interface ModelRetryInfo {
  status: "countdown" | "retrying";
  attempt: number;
  nextAttempt: number;
  maxAttempts: number;
  waitMs: number;
  retryInSeconds: number;
  error: string;
  errorDetail?: string;
}

/** `_hoomanjs/model_retry` notification params: retry progress plus the owning session. */
export interface ModelRetryNotification extends ModelRetryInfo {
  sessionId: string;
}

/**
 * A file, folder, or in-memory image staged for (or sent with) a prompt.
 * Path-backed attachments come from the native file dialog or drags that
 * carry a `text/uri-list` (VS Code explorer); data-backed ones come from OS
 * drops and clipboard pastes, where the webview only gets the bytes. At send
 * time images become ACP `image` blocks, paths become `resource_link` blocks,
 * and pathless non-image data becomes an embedded blob `resource`.
 */
export interface AttachmentInfo {
  id: string;
  /** Display name (basename). */
  name: string;
  kind: "image" | "file" | "directory";
  /** Absolute filesystem path, when known. */
  path?: string;
  /** Base64 payload for attachments without a path. */
  data?: string;
  mimeType?: string;
  /** 1-indexed, inclusive line range, set for editor-selection attachments. */
  range?: { start: number; end: number };
}

/** A prompt submitted while a turn was already running, waiting to run next (or be steered into the active turn). */
export interface QueuedPromptInfo {
  id: string;
  text: string;
  attachments?: AttachmentInfo[];
}

/** One persisted session row for the webview's Sessions panel. */
export interface SessionRowInfo {
  sessionId: string;
  cwd: string;
  title: string;
  updatedAt?: string;
  /** Currently active in the chat panel. */
  current: boolean;
  /** This open session currently has a turn running. */
  busy: boolean;
}

/** One open chat tab in the webview. */
export interface TabInfo {
  sessionId: string;
  title: string;
  busy: boolean;
  pendingPermissions?: number;
  unread?: boolean;
}

/** Route-like identifier for the shared Hooman webview app. */
export type WebviewRoute =
  | "/"
  | "/chat"
  | `/plans/${string}`
  | `/config/${string}`
  | `/mcp/${string}`
  | `/instructions/${string}`
  | "/skills";

/** State for the custom `.plan.md` surface rendered by the shared webview app. */
export interface PlanEditorStateInfo {
  path: string;
  name: string;
  text: string;
  modelLabel: string;
  modeLabel?: string;
  busy: boolean;
  dirty: boolean;
}

/** Messages sent from the webview to the extension host. */
export type InboundMessage =
  | { type: "ready" }
  | { type: "prompt"; text: string; attachments?: AttachmentInfo[] }
  | { type: "cancel" }
  | {
      type: "setConfigOption";
      configId: string;
      value: string | boolean;
      boolean?: boolean;
    }
  | { type: "permissionResponse"; requestId: string; optionId: string }
  | {
      type: "editAction";
      action: "diff" | "keep" | "undo" | "keepAll" | "undoAll";
      path?: string;
    }
  | { type: "queueDelete"; id: string }
  | { type: "queueSendNow"; id: string }
  | { type: "queueEdit"; id: string }
  | { type: "steerQueue" }
  | { type: "pickFiles" }
  | { type: "resolveDropped"; uris: string[] }
  | { type: "openAttachment"; attachment: AttachmentInfo }
  | { type: "openLink"; href: string }
  | { type: "listSessions" }
  | { type: "sessionsClosed" }
  | { type: "openSession"; sessionId: string; cwd: string; title: string }
  | { type: "activateTab"; sessionId: string }
  | { type: "closeTab"; sessionId: string }
  | { type: "deleteSession"; sessionId: string; title: string }
  | { type: "newChat" }
  | { type: "forkChat" }
  | { type: "pickModel" }
  | { type: "build" }
  | { type: "editMarkdown" }
  | { type: "refresh" }
  | { type: "configEditorAction"; action: ConfigEditorAction }
  | { type: "mcpEditorAction"; action: McpEditorAction }
  | { type: "instructionsEditorAction"; action: InstructionsEditorAction }
  | { type: "skillsViewAction"; action: SkillsViewAction };

/** Messages sent from the extension host to the webview. */
export type OutboundMessage =
  | {
      type: "state";
      sessionId: string;
      configOptions: SessionConfigOption[];
      commands: CommandInfo[];
      busy: boolean;
      queue: QueuedPromptInfo[];
    }
  | { type: "route"; route: WebviewRoute }
  | { type: "planState"; state: PlanEditorStateInfo }
  | { type: "configEditorState"; state: ConfigEditorStateInfo }
  | { type: "mcpEditorState"; state: McpEditorStateInfo }
  | { type: "instructionsEditorState"; state: InstructionsEditorStateInfo }
  | { type: "skillsViewState"; state: SkillsViewStateInfo }
  | {
      type: "tabs";
      tabs: TabInfo[];
      activeSessionId: string | null;
    }
  | {
      type: "configOptions";
      sessionId: string;
      configOptions: SessionConfigOption[];
    }
  | { type: "update"; sessionId: string; update: SessionUpdate }
  | { type: "promptStart"; sessionId: string }
  | { type: "promptEnd"; sessionId: string; stopReason?: string }
  | {
      type: "permission";
      sessionId: string;
      requestId: string;
      title: string;
      detail?: string;
      options: PermissionOptionInfo[];
      /** Agent question (`ask_user`) rather than a tool approval; rendered as a question card. */
      question?: boolean;
    }
  | {
      type: "permissionResolved";
      sessionId: string;
      requestId: string;
      note?: string;
    }
  | { type: "clear"; sessionId: string }
  | { type: "edits"; sessionId: string; edits: EditInfo[] }
  | { type: "queue"; sessionId: string; items: QueuedPromptInfo[] }
  | {
      type: "queueEditText";
      sessionId: string;
      text: string;
      attachments?: AttachmentInfo[];
    }
  | { type: "attachments"; sessionId: string; attachments: AttachmentInfo[] }
  | { type: "download"; sessionId: string; download: ModelDownloadInfo | null }
  | { type: "retry"; sessionId: string; retry: ModelRetryInfo | null }
  | { type: "sessions"; sessions: SessionRowInfo[] }
  | { type: "showSessions" }
  | {
      type: "sessionLoading";
      sessionId: string;
      loading: boolean;
      title?: string;
    }
  | { type: "error"; sessionId: string; message: string };
