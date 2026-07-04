import type {
  PermissionOptionKind,
  SessionConfigOption,
  SessionUpdate,
} from "@agentclientprotocol/sdk";

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
  /** Currently loaded in the chat panel. */
  current: boolean;
  /** Currently loaded AND a turn is running. */
  busy: boolean;
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
  | { type: "listSessions" }
  | { type: "sessionsClosed" }
  | { type: "openSession"; sessionId: string; cwd: string; title: string }
  | { type: "deleteSession"; sessionId: string; title: string }
  | { type: "newChat" };

/** Messages sent from the extension host to the webview. */
export type OutboundMessage =
  | {
      type: "state";
      configOptions: SessionConfigOption[];
      commands: CommandInfo[];
      busy: boolean;
      queue: QueuedPromptInfo[];
    }
  | { type: "configOptions"; configOptions: SessionConfigOption[] }
  | { type: "update"; update: SessionUpdate }
  | { type: "promptStart" }
  | { type: "promptEnd"; stopReason?: string }
  | {
      type: "permission";
      requestId: string;
      title: string;
      detail?: string;
      options: PermissionOptionInfo[];
      /** Agent question (`ask_user`) rather than a tool approval; rendered as a question card. */
      question?: boolean;
    }
  | { type: "permissionResolved"; requestId: string; note?: string }
  | { type: "clear" }
  | { type: "edits"; edits: EditInfo[] }
  | { type: "queue"; items: QueuedPromptInfo[] }
  | { type: "queueEditText"; text: string; attachments?: AttachmentInfo[] }
  | { type: "attachments"; attachments: AttachmentInfo[] }
  | { type: "sessions"; sessions: SessionRowInfo[] }
  | { type: "showSessions" }
  | { type: "sessionLoading"; loading: boolean; title?: string }
  | { type: "error"; message: string };
