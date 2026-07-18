/**
 * Platform-neutral ACP session-update types shared across the Desktop
 * client's process boundaries — consumed by `acp-client` and `main` (Node)
 * as well as `renderer` (browser), same as `ipc-contract.ts`, plus
 * `session-reducer.ts`'s pure reducer over this surface.
 *
 * This mirrors the subset of the ACP `session/update` surface the desktop
 * chat UI needs (see `src/acp/acp-agent.ts` / `src/acp/session-config.ts` in
 * the root package and the ACP SDK's `schema/types.gen.d.ts`): text content,
 * tool calls, plans, session config options (model/effort/mode/yolo),
 * available commands, and usage/cost/context. Extend here — not in a
 * platform adapter — when broader parity (images, resource links, embedded
 * context blocks) is implemented.
 */

export type TextContent = { type: "text"; text: string };

/** Content blocks accepted by ACP `session/prompt` (a scoped subset: text, images, embedded resources). */
export type PromptImageContent = {
  type: "image";
  data: string;
  mimeType: string;
};
export type PromptResourceContent = {
  type: "resource";
  resource: { uri: string; mimeType?: string; text?: string; blob?: string };
};
/** A path-backed attachment sent by reference (file or directory) — the agent never reads its bytes. */
export type PromptResourceLinkContent = {
  type: "resource_link";
  uri: string;
  name: string;
  mimeType?: string;
  size?: number;
};
export type PromptContentBlock =
  | TextContent
  | PromptImageContent
  | PromptResourceContent
  | PromptResourceLinkContent;

export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

export type FileDiff = {
  path: string;
  oldText: string | null;
  newText: string;
};

export type ToolCallContentItem =
  | TextContent
  | { type: "content"; content: TextContent }
  | ({ type: "diff" } & FileDiff)
  | { type: "terminal"; terminalId: string };

export type ToolCallUpdateFields = {
  toolCallId: string;
  title?: string;
  kind?: string;
  status?: ToolCallStatus;
  rawInput?: unknown;
  content?: ToolCallContentItem[];
  locations?: Array<{ path: string; line?: number }>;
  /** Carries custom out-of-band signals, e.g. `_meta["hoomanjs/shell_job"]`. */
  _meta?: Record<string, unknown>;
};

/** One active background shell job, surfaced via `_meta["hoomanjs/shell_job"]`. */
export type ShellJobInfo = {
  jobId: string;
  description: string;
  status: string;
  /** True while a Stop request is in flight for this job. */
  stopping?: boolean;
};

/** One agent-modified file pending review, derived from tool-call diffs since its last keep/undo. */
export type TrackedEdit = {
  path: string;
  oldText: string | null;
  newText: string;
};

export type PlanEntry = {
  content: string;
  status: "pending" | "in_progress" | "completed";
  priority?: "low" | "medium" | "high";
};

/** One selectable value for a `select`-type session config option (ACP `SessionConfigSelectOption`). */
export type SessionConfigSelectOption = {
  value: string;
  name: string;
  description?: string;
};

export type SessionConfigOptionBase = {
  id: string;
  name: string;
  description?: string;
  category?: "mode" | "model" | "model_config" | "thought_level" | string;
};

/** Mirrors ACP's `SessionConfigOption` discriminated union: model/effort/mode selectors, the yolo toggle. */
export type SessionConfigOption =
  | (SessionConfigOptionBase & {
      type: "select";
      currentValue: string;
      options: SessionConfigSelectOption[];
    })
  | (SessionConfigOptionBase & { type: "boolean"; currentValue: boolean });

export type AvailableCommand = { name: string; description: string };

/** Per-turn token meter, carried in `usage_update._meta["hoomanjs/tokens"]`. */
export type TurnUsage = {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  tokensPerSecond?: number;
};

export type SessionUpdate =
  | {
      sessionUpdate: "user_message_chunk";
      content: TextContent;
      messageId?: string;
    }
  | {
      sessionUpdate: "agent_message_chunk";
      content: TextContent;
      messageId: string;
      /** Carries custom out-of-band signals, e.g. `_meta["hoomanjs/shell_job"]`. */
      _meta?: Record<string, unknown>;
    }
  | {
      sessionUpdate: "agent_thought_chunk";
      content: TextContent;
      messageId: string;
    }
  | ({ sessionUpdate: "tool_call" } & ToolCallUpdateFields)
  | ({ sessionUpdate: "tool_call_update" } & ToolCallUpdateFields)
  | { sessionUpdate: "plan"; entries: PlanEntry[] }
  | { sessionUpdate: "current_mode_update"; currentModeId: string }
  | {
      sessionUpdate: "config_option_update";
      configOptions: SessionConfigOption[];
    }
  | {
      sessionUpdate: "available_commands_update";
      availableCommands: AvailableCommand[];
    }
  | {
      sessionUpdate: "usage_update";
      used: number;
      size: number;
      cost?: { amount: number; currency: string };
      _meta?: { "hoomanjs/tokens"?: TurnUsage };
    };

export type SessionNotification = {
  sessionId: string;
  update: SessionUpdate;
};

export type TranscriptRole = "user" | "assistant" | "thought";

export type TranscriptMessage = {
  kind: "message";
  id: string;
  role: TranscriptRole;
  text: string;
};

export type TranscriptToolCall = {
  kind: "tool-call";
  id: string;
  title: string;
  toolKind?: string;
  status: ToolCallStatus;
  rawInput?: unknown;
  outputText?: string;
  locations: Array<{ path: string; line?: number }>;
  diffs: FileDiff[];
  terminalIds: string[];
};

export type TranscriptItem = TranscriptMessage | TranscriptToolCall;

export type TranscriptState = {
  items: TranscriptItem[];
  plan: PlanEntry[];
  currentModeId: string | null;
  configOptions: SessionConfigOption[];
  commands: AvailableCommand[];
  context: { used: number; size: number } | null;
  cost: { amount: number; currency: string } | null;
  turnUsage: TurnUsage | null;
  shellJobs: ShellJobInfo[];
  /**
   * Per-path `items` index threshold: diffs at or before this index are
   * already kept/undone. Diffs after it are still pending review. See
   * {@link resolveEdit}/{@link resolveAllEdits} in `reducer.ts`.
   */
  editResets: Record<string, number>;
};

export const EMPTY_TRANSCRIPT: TranscriptState = {
  items: [],
  plan: [],
  currentModeId: null,
  configOptions: [],
  commands: [],
  context: null,
  cost: null,
  turnUsage: null,
  shellJobs: [],
  editResets: {},
};
