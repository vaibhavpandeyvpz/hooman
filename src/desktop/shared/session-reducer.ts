import type {
  FileDiff,
  PlanEntry,
  ShellJobInfo,
  SessionUpdate,
  TextContent,
  ToolCallContentItem,
  ToolCallStatus,
  ToolCallUpdateFields,
  TrackedEdit,
  TranscriptItem,
  TranscriptState,
  TranscriptToolCall,
} from "./session-types.js";

export * from "./session-types.js";

function flattenText(content: ToolCallContentItem[]): string {
  return content
    .filter(
      (
        entry,
      ): entry is TextContent | { type: "content"; content: TextContent } =>
        entry.type !== "diff" && entry.type !== "terminal",
    )
    .map((entry) => ("text" in entry ? entry.text : entry.content.text))
    .join("");
}

function extractDiffs(content: ToolCallContentItem[]): FileDiff[] {
  return content
    .filter(
      (entry): entry is { type: "diff" } & FileDiff => entry.type === "diff",
    )
    .map(({ path, oldText, newText }) => ({ path, oldText, newText }));
}

function extractTerminalIds(content: ToolCallContentItem[]): string[] {
  return content
    .filter(
      (entry): entry is { type: "terminal"; terminalId: string } =>
        entry.type === "terminal",
    )
    .map((entry) => entry.terminalId);
}

function upsertToolCall(
  items: TranscriptItem[],
  fields: ToolCallUpdateFields,
  defaultStatus: ToolCallStatus,
): TranscriptItem[] {
  const index = items.findIndex(
    (item) => item.kind === "tool-call" && item.id === fields.toolCallId,
  );
  const existing =
    index >= 0 ? (items[index] as TranscriptToolCall) : undefined;
  const merged: TranscriptToolCall = {
    kind: "tool-call",
    id: fields.toolCallId,
    title: fields.title ?? existing?.title ?? fields.toolCallId,
    toolKind: fields.kind ?? existing?.toolKind,
    status: fields.status ?? existing?.status ?? defaultStatus,
    rawInput: fields.rawInput ?? existing?.rawInput,
    outputText: fields.content
      ? flattenText(fields.content)
      : existing?.outputText,
    locations: fields.locations ?? existing?.locations ?? [],
    diffs: fields.content
      ? extractDiffs(fields.content)
      : (existing?.diffs ?? []),
    terminalIds: fields.content
      ? extractTerminalIds(fields.content)
      : (existing?.terminalIds ?? []),
  };
  if (index >= 0) {
    const next = items.slice();
    next[index] = merged;
    return next;
  }
  return [...items, merged];
}

type ShellJobMeta = {
  event?: string;
  job_id?: string;
  description?: string;
  status?: string;
};

/**
 * Applies one `_meta["hoomanjs/shell_job"]` payload (see `src/acp/acp-agent.ts`
 * in the root package): a `started`/`running`-ish event upserts the job, a
 * terminal `completed`/`stopped`/`failed` event removes it.
 */
function applyShellJobMeta(
  state: TranscriptState,
  raw: unknown,
): TranscriptState {
  const meta = raw as ShellJobMeta | undefined;
  if (!meta?.job_id) {
    return state;
  }
  if (
    meta.event === "completed" ||
    meta.event === "stopped" ||
    meta.event === "failed"
  ) {
    const jobId = meta.job_id;
    return {
      ...state,
      shellJobs: state.shellJobs.filter((job) => job.jobId !== jobId),
    };
  }
  const info: ShellJobInfo = {
    jobId: meta.job_id,
    description: meta.description ?? meta.job_id,
    status: meta.status ?? meta.event ?? "running",
  };
  const index = state.shellJobs.findIndex((job) => job.jobId === info.jobId);
  const shellJobs =
    index >= 0
      ? state.shellJobs.map((job, i) =>
          i === index ? { ...job, ...info } : job,
        )
      : [...state.shellJobs, info];
  return { ...state, shellJobs };
}

/**
 * Chunks are keyed by `(role, messageId)`, not `messageId` alone: some
 * agents reuse one turn-level `messageId` for both the thought and the
 * final answer, which would otherwise merge a thought block and its
 * following assistant message into one bubble.
 */
function appendOrExtendMessage(
  items: TranscriptItem[],
  role: "user" | "assistant" | "thought",
  messageId: string,
  content: TextContent,
): TranscriptItem[] {
  const index = items.findIndex(
    (item) =>
      item.kind === "message" && item.id === messageId && item.role === role,
  );
  if (index >= 0) {
    const existing = items[index];
    if (existing?.kind !== "message") return items;
    const next = items.slice();
    next[index] = { ...existing, text: existing.text + content.text };
    return next;
  }
  return [
    ...items,
    { kind: "message", id: messageId, role, text: content.text },
  ];
}

/**
 * Pure reducer over a session's `SessionUpdate` stream. No I/O, no platform
 * APIs — safe to unit test with recorded fixtures and to reuse from any
 * client (desktop, a future rewritten VS Code webview, tests).
 */
export function applySessionUpdate(
  state: TranscriptState,
  update: SessionUpdate,
): TranscriptState {
  switch (update.sessionUpdate) {
    case "user_message_chunk": {
      const id = update.messageId ?? `user-${state.items.length}`;
      return {
        ...state,
        items: appendOrExtendMessage(state.items, "user", id, update.content),
      };
    }
    case "agent_message_chunk": {
      const withJob = update._meta
        ? applyShellJobMeta(state, update._meta["hoomanjs/shell_job"])
        : state;
      // Terminal shell-job events piggyback on an empty-text chunk purely to
      // carry `_meta` — nothing should land in the transcript for those.
      if (update.content.text === "" && update._meta?.["hoomanjs/shell_job"]) {
        return withJob;
      }
      return {
        ...withJob,
        items: appendOrExtendMessage(
          withJob.items,
          "assistant",
          update.messageId,
          update.content,
        ),
      };
    }
    case "agent_thought_chunk":
      return {
        ...state,
        items: appendOrExtendMessage(
          state.items,
          "thought",
          update.messageId,
          update.content,
        ),
      };
    case "tool_call":
      return {
        ...state,
        items: upsertToolCall(state.items, update, "pending"),
      };
    case "tool_call_update": {
      // Background shell jobs announce themselves ("started") on the
      // `tool_call_update` that completes the launching `shell` tool call.
      const withJob = update._meta
        ? applyShellJobMeta(state, update._meta["hoomanjs/shell_job"])
        : state;
      return {
        ...withJob,
        items: upsertToolCall(withJob.items, update, "in_progress"),
      };
    }
    case "plan":
      return { ...state, plan: update.entries as PlanEntry[] };
    case "current_mode_update":
      return { ...state, currentModeId: update.currentModeId };
    case "config_option_update":
      return { ...state, configOptions: update.configOptions };
    case "available_commands_update":
      return { ...state, commands: update.availableCommands };
    case "usage_update":
      return {
        ...state,
        context: { used: update.used, size: update.size },
        cost: update.cost ?? state.cost,
        turnUsage: update._meta?.["hoomanjs/tokens"] ?? state.turnUsage,
      };
    default:
      return state;
  }
}

/** Optimistically mark a background job as stopping while `_hoomanjs/stop_shell_job` is in flight. */
export function markShellJobStopping(
  state: TranscriptState,
  jobId: string,
): TranscriptState {
  return {
    ...state,
    shellJobs: state.shellJobs.map((job) =>
      job.jobId === jobId ? { ...job, stopping: true } : job,
    ),
  };
}

/** Accept or revert one file's pending edits: hides it from {@link selectPendingEdits} until it's written again. */
export function resolveEdit(
  state: TranscriptState,
  path: string,
): TranscriptState {
  return {
    ...state,
    editResets: { ...state.editResets, [path]: state.items.length - 1 },
  };
}

/** Accept or revert every currently-pending path in one step (e.g. "Keep all" / "Undo all"). */
export function resolveAllEdits(
  state: TranscriptState,
  paths: string[],
): TranscriptState {
  const editResets = { ...state.editResets };
  for (const path of paths) {
    editResets[path] = state.items.length - 1;
  }
  return { ...state, editResets };
}

/**
 * Files touched by tool-call diffs since each path's last keep/undo,
 * collapsed to one cumulative before/after pair per path (earliest `oldText`,
 * latest `newText`) — the "Changes" panel's pending-review list.
 */
export function selectPendingEdits(state: TranscriptState): TrackedEdit[] {
  const byPath = new Map<string, TrackedEdit>();
  state.items.forEach((item, index) => {
    if (item.kind !== "tool-call") {
      return;
    }
    for (const diff of item.diffs) {
      const resetAt = state.editResets[diff.path] ?? -1;
      if (index <= resetAt) {
        continue;
      }
      const existing = byPath.get(diff.path);
      byPath.set(diff.path, {
        path: diff.path,
        oldText: existing ? existing.oldText : diff.oldText,
        newText: diff.newText,
      });
    }
  });
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}
