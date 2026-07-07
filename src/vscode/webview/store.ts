import { createStore, produce } from "solid-js/store";
import type {
  PlanEntry,
  SessionConfigOption,
  ToolCallContent,
} from "@agentclientprotocol/sdk";
import type {
  AttachmentInfo,
  CommandInfo,
  ContextUsageInfo,
  CostInfo,
  EditInfo,
  ModelDownloadInfo,
  OutboundMessage,
  PermissionOptionInfo,
  PlanEditorStateInfo,
  QueuedPromptInfo,
  SessionRowInfo,
  TokenTotals,
  WebviewRoute,
} from "../src/shared/protocol";
import { onHostMessage, post } from "./lib/vscode-api";
import { estimateTokens } from "./lib/format";

export type ToolCallStatusUi =
  "pending" | "in_progress" | "completed" | "failed";

export type TranscriptItem =
  | { kind: "user"; id: string; text: string; attachments?: AttachmentInfo[] }
  | { kind: "assistant"; id: string; text: string }
  | {
      kind: "thought";
      id: string;
      text: string;
      startedAt: number;
      finishedAt: number | null;
    }
  | {
      kind: "tool";
      id: string;
      title: string;
      toolKind?: string;
      status: ToolCallStatusUi;
      rawInput?: unknown;
      content: ToolCallContent[];
      live: boolean;
    }
  | {
      kind: "permission";
      id: string;
      title: string;
      detail?: string;
      options: PermissionOptionInfo[];
      /** Agent question (`ask_user`) rather than a tool approval. */
      question?: boolean;
      resolvedNote: string | null;
    }
  | { kind: "error"; id: string; message: string };

export type Activity =
  | { type: "idle" }
  | { type: "thinking" }
  | { type: "streaming" }
  | { type: "tool"; title: string };

interface State {
  route: WebviewRoute;
  planView: PlanEditorStateInfo | null;
  items: TranscriptItem[];
  busy: boolean;
  promptStartedAt: number | null;
  activity: Activity;
  configOptions: SessionConfigOption[];
  commands: CommandInfo[];
  plan: PlanEntry[];
  edits: EditInfo[];
  usage: TokenTotals | null;
  /** Context-window utilization; null until the agent reports a resolved window size. */
  context: ContextUsageInfo | null;
  /** Cumulative session cost; null while pricing is unresolved. */
  cost: CostInfo | null;
  /** Live model-weights download (llama.cpp GGUF fetch); null when idle. */
  download: ModelDownloadInfo | null;
  queue: QueuedPromptInfo[];
  /** Text handed back from a queued item picked for editing; the composer consumes and clears it. */
  editDraft: string | null;
  /** Attachments staged in the composer, sent with the next prompt. */
  attachments: AttachmentInfo[];
  /** Whether the Sessions overlay panel is open. */
  sessionsOpen: boolean;
  /** Persisted sessions shown in the Sessions overlay (host keeps it fresh while open). */
  sessions: SessionRowInfo[];
  /** Title of the session currently being switched to (blur-loader overlay), or null. */
  loadingSession: string | null;
}

const [state, setState] = createStore<State>({
  route: "/",
  planView: null,
  items: [],
  busy: false,
  promptStartedAt: null,
  activity: { type: "idle" },
  configOptions: [],
  commands: [],
  plan: [],
  edits: [],
  usage: null,
  context: null,
  cost: null,
  download: null,
  queue: [],
  editDraft: null,
  attachments: [],
  sessionsOpen: false,
  sessions: [],
  loadingSession: null,
});

export { state };

/** Tool calls fully represented elsewhere (the todo tool -> pinned plan panel) shouldn't also render a raw card. */
const hiddenToolCalls = new Set<string>();
/** Which transcript item id is the live target of the current stream, so the next chunk of the same kind extends it. */
let openStreamId: string | null = null;
let openStreamKind: "assistant" | "thought" | null = null;

function pushItem(item: TranscriptItem): void {
  setState("items", (items) => [...items, item]);
}

function itemIndex(id: string): number {
  return state.items.findIndex((item) => item.id === id);
}

/** Stop extending the current stream target (a new item kind, or a turn boundary, breaks it). */
function breakStream(): void {
  if (openStreamKind === "thought" && openStreamId) {
    finalizeThought(openStreamId);
  }
  openStreamId = null;
  openStreamKind = null;
  openUserMessageId = null;
  openUserItemId = null;
}

function finalizeThought(id: string): void {
  const index = itemIndex(id);
  if (index === -1) {
    return;
  }
  setState("items", index, (item) =>
    item.kind === "thought" && item.finishedAt === null
      ? { ...item, finishedAt: Date.now() }
      : item,
  );
}

function addUserMessage(text: string, attachments?: AttachmentInfo[]): void {
  breakStream();
  pushItem({
    kind: "user",
    id: crypto.randomUUID(),
    text,
    ...(attachments?.length ? { attachments } : {}),
  });
}

/**
 * The user message currently receiving chunks: replayed history (session/load)
 * streams one `user_message_chunk` per content block with a shared
 * `messageId`, and they should coalesce into a single bubble.
 */
let openUserMessageId: string | null = null;
let openUserItemId: string | null = null;

function appendToUserMessage(
  messageId: string | undefined,
  part: { text?: string; attachment?: AttachmentInfo },
): void {
  const isContinuation =
    messageId !== undefined &&
    messageId === openUserMessageId &&
    openUserItemId !== null &&
    itemIndex(openUserItemId) !== -1;
  if (!isContinuation) {
    breakStream();
    const id = crypto.randomUUID();
    pushItem({ kind: "user", id, text: "" });
    openUserItemId = id;
    openUserMessageId = messageId ?? null;
  }
  setState(
    "items",
    itemIndex(openUserItemId!),
    produce((item) => {
      if (item.kind !== "user") {
        return;
      }
      if (part.text) {
        item.text = item.text ? `${item.text}\n\n${part.text}` : part.text;
      }
      if (part.attachment) {
        item.attachments = [...(item.attachments ?? []), part.attachment];
      }
    }),
  );
}

function base64FromText(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function nameFromUri(uri: string, fallback: string): string {
  try {
    const path = decodeURIComponent(new URL(uri).pathname);
    const tail = path.split("/").pop();
    return tail && tail.length > 0 ? tail : fallback;
  } catch {
    return fallback;
  }
}

function extensionFromMime(mime: string): string {
  const subtype = mime.split(";")[0]?.split("/")[1] ?? "";
  return subtype ? `.${subtype.replace(/^x-/, "")}` : "";
}

type UserChunkContent = Extract<
  SessionUpdatePayload,
  { sessionUpdate: "user_message_chunk" }
>["content"];

/**
 * Render a non-text prompt block (replayed by the agent per the ACP spec) as
 * an attachment pill, mirroring how the composer shows staged attachments.
 */
function userChunkToPart(
  content: UserChunkContent,
): { text?: string; attachment?: AttachmentInfo } | null {
  switch (content?.type) {
    case "text":
      return { text: content.text };
    case "image":
      return {
        attachment: {
          id: crypto.randomUUID(),
          name: `image${extensionFromMime(content.mimeType) || ".png"}`,
          kind: "image",
          data: content.data,
          mimeType: content.mimeType,
        },
      };
    case "resource": {
      const resource = content.resource;
      const name = nameFromUri(resource.uri, "attachment");
      const mimeType = resource.mimeType ?? undefined;
      const data =
        "blob" in resource ? resource.blob : base64FromText(resource.text);
      return {
        attachment: {
          id: crypto.randomUUID(),
          name,
          kind: mimeType?.startsWith("image/") ? "image" : "file",
          data,
          mimeType,
        },
      };
    }
    case "resource_link": {
      const path = content.uri.startsWith("file://")
        ? decodeURIComponent(new URL(content.uri).pathname)
        : undefined;
      return {
        attachment: {
          id: crypto.randomUUID(),
          name: content.name || nameFromUri(content.uri, "attachment"),
          kind: content.mimeType?.startsWith("image/") ? "image" : "file",
          path,
          mimeType: content.mimeType ?? undefined,
        },
      };
    }
    default:
      return null;
  }
}

function appendAssistantText(text: string): void {
  if (openStreamKind === "thought") {
    breakStream();
  }
  if (openStreamKind !== "assistant") {
    const id = crypto.randomUUID();
    pushItem({ kind: "assistant", id, text: "" });
    openStreamId = id;
    openStreamKind = "assistant";
  }
  const id = openStreamId!;
  setState(
    "items",
    itemIndex(id),
    produce((item) => {
      if (item.kind === "assistant") {
        item.text += text;
      }
    }),
  );
  setState("activity", { type: "streaming" });
}

function appendThoughtText(text: string): void {
  if (openStreamKind === "assistant") {
    breakStream();
  }
  if (openStreamKind !== "thought") {
    const id = crypto.randomUUID();
    pushItem({
      kind: "thought",
      id,
      text: "",
      startedAt: Date.now(),
      finishedAt: null,
    });
    openStreamId = id;
    openStreamKind = "thought";
  }
  const id = openStreamId!;
  setState(
    "items",
    itemIndex(id),
    produce((item) => {
      if (item.kind === "thought") {
        item.text += text;
      }
    }),
  );
  setState("activity", { type: "thinking" });
}

function upsertToolCall(update: {
  toolCallId: string;
  title?: string | null;
  kind?: string | null;
  status?: string | null;
  rawInput?: unknown;
  content?: ToolCallContent[] | null;
  _meta?: { [key: string]: unknown } | null;
}): void {
  if (update.title === "update_todos") {
    hiddenToolCalls.add(update.toolCallId);
  }
  if (hiddenToolCalls.has(update.toolCallId)) {
    return;
  }
  breakStream();
  const live = Boolean(update._meta?.["hoomanjs/live"]);
  const index = itemIndex(update.toolCallId);
  if (index === -1) {
    pushItem({
      kind: "tool",
      id: update.toolCallId,
      title: update.title ?? "Tool",
      toolKind: update.kind ?? undefined,
      status: (update.status as ToolCallStatusUi) ?? "pending",
      rawInput: update.rawInput,
      content: update.content ?? [],
      live,
    });
    if (
      update.status &&
      update.status !== "completed" &&
      update.status !== "failed"
    ) {
      setState("activity", { type: "tool", title: update.title ?? "Tool" });
    }
    return;
  }
  setState(
    "items",
    index,
    produce((item) => {
      if (item.kind !== "tool") {
        return;
      }
      if (update.title) {
        item.title = update.title;
      }
      if (update.kind) {
        item.toolKind = update.kind;
      }
      if (update.status) {
        item.status = update.status as ToolCallStatusUi;
      }
      if (update.rawInput !== undefined) {
        item.rawInput = update.rawInput;
      }
      if (update.content) {
        item.content = update.content;
      }
      item.live = live;
    }),
  );
  const current = state.items[index];
  if (
    current?.kind === "tool" &&
    (update.status === "completed" || update.status === "failed")
  ) {
    setState("activity", { type: "idle" });
  } else if (current?.kind === "tool") {
    setState("activity", { type: "tool", title: current.title });
  }
}

type SessionUpdatePayload = Extract<
  OutboundMessage,
  { type: "update" }
>["update"];

function handleSessionUpdate(update: SessionUpdatePayload): void {
  switch (update.sessionUpdate) {
    case "user_message_chunk": {
      const part = userChunkToPart(update.content);
      if (part) {
        appendToUserMessage(update.messageId ?? undefined, part);
      }
      break;
    }
    case "agent_message_chunk":
      if (update.content?.type === "text") {
        appendAssistantText(update.content.text);
      }
      break;
    case "agent_thought_chunk":
      if (update.content?.type === "text") {
        appendThoughtText(update.content.text);
      }
      break;
    case "tool_call":
    case "tool_call_update":
      upsertToolCall(update);
      break;
    case "plan":
      setState("plan", update.entries ?? []);
      break;
    case "usage_update": {
      const tokens = update._meta?.["hoomanjs/tokens"] as
        TokenTotals | undefined;
      if (tokens) {
        setState("usage", tokens);
      }
      // `size: 0` means the context window could not be resolved (no billing
      // config and no models.dev hit) — show nothing rather than a made-up %.
      setState(
        "context",
        update.size > 0 ? { used: update.used, size: update.size } : null,
      );
      setState(
        "cost",
        update.cost
          ? { amount: update.cost.amount, currency: update.cost.currency }
          : null,
      );
      break;
    }
    case "available_commands_update":
      setState("commands", update.availableCommands ?? []);
      break;
    default:
      break;
  }
}

const pendingPermissions = new Set<string>();

function showPermission(
  msg: Extract<OutboundMessage, { type: "permission" }>,
): void {
  breakStream();
  pendingPermissions.add(msg.requestId);
  pushItem({
    kind: "permission",
    id: msg.requestId,
    title: msg.title,
    detail: msg.detail,
    options: msg.options,
    question: msg.question,
    resolvedNote: null,
  });
}

function resolvePermission(requestId: string, note?: string): void {
  pendingPermissions.delete(requestId);
  const index = itemIndex(requestId);
  if (index === -1) {
    return;
  }
  setState(
    "items",
    index,
    produce((item) => {
      if (item.kind === "permission") {
        item.resolvedNote = note ?? "Responded";
      }
    }),
  );
}

function clearChat(): void {
  hiddenToolCalls.clear();
  openStreamId = null;
  openStreamKind = null;
  openUserMessageId = null;
  openUserItemId = null;
  pendingPermissions.clear();
  setState({
    items: [],
    plan: [],
    edits: [],
    usage: null,
    context: null,
    cost: null,
    download: null,
    queue: [],
    editDraft: null,
    attachments: [],
    activity: { type: "idle" },
  });
}

onHostMessage((msg) => {
  switch (msg.type) {
    case "state":
      setState({
        configOptions: msg.configOptions,
        commands: msg.commands,
        busy: msg.busy,
        queue: msg.queue,
      });
      break;
    case "route":
      setState("route", msg.route);
      break;
    case "planState":
      setState("planView", msg.state);
      break;
    case "configOptions":
      setState("configOptions", msg.configOptions);
      break;
    case "update":
      handleSessionUpdate(msg.update);
      break;
    case "promptStart":
      setState({
        busy: true,
        promptStartedAt: Date.now(),
        activity: { type: "thinking" },
      });
      break;
    case "promptEnd":
      breakStream();
      setState({
        busy: false,
        promptStartedAt: null,
        activity: { type: "idle" },
        download: null,
      });
      break;
    case "download":
      setState("download", msg.download);
      break;
    case "permission":
      showPermission(msg);
      break;
    case "permissionResolved":
      resolvePermission(msg.requestId, msg.note);
      break;
    case "clear":
      clearChat();
      break;
    case "edits":
      setState("edits", msg.edits);
      break;
    case "queue":
      setState("queue", msg.items);
      break;
    case "queueEditText":
      if (msg.attachments?.length) {
        setState("attachments", (staged) => [...staged, ...msg.attachments!]);
      }
      setState("editDraft", msg.text);
      break;
    case "attachments":
      setState("attachments", (staged) => [...staged, ...msg.attachments]);
      break;
    case "sessions":
      setState("sessions", msg.sessions);
      break;
    case "showSessions":
      setState("sessionsOpen", true);
      break;
    case "sessionLoading":
      setState(
        "loadingSession",
        msg.loading ? (msg.title ?? "Loading session") : null,
      );
      break;
    case "error":
      breakStream();
      pushItem({
        kind: "error",
        id: crypto.randomUUID(),
        message: msg.message,
      });
      setState({
        busy: false,
        promptStartedAt: null,
        activity: { type: "idle" },
        download: null,
      });
      break;
    default:
      break;
  }
});

post({ type: "ready" });

// ---- Actions callable from components -------------------------------------

/** Submits immediately if idle; queues (host-side) to run after the active turn otherwise. */
export function submitPrompt(text: string): void {
  const trimmed = text.trim();
  // Plain copies: Solid store items are Proxy objects, which the webview's
  // structured-clone postMessage cannot serialize (DataCloneError).
  const attachments = state.attachments.map((attachment) => ({
    ...attachment,
  }));
  if (!trimmed && attachments.length === 0) {
    return;
  }
  if (!state.busy) {
    addUserMessage(trimmed, attachments);
  }
  setState("attachments", []);
  post({ type: "prompt", text: trimmed, attachments });
}

export function cancelPrompt(): void {
  post({ type: "cancel" });
}

export function queueDeletePrompt(id: string): void {
  post({ type: "queueDelete", id });
}

/** Runs (or steers into the active turn) a single queued item immediately, out of order. */
export function queueSendNow(id: string): void {
  post({ type: "queueSendNow", id });
}

/** Pulls a queued item's text back into the composer for editing. */
export function queueEditPrompt(id: string): void {
  post({ type: "queueEdit", id });
}

/** Drains the whole queue into the currently running turn's guidance. */
export function steerQueue(): void {
  post({ type: "steerQueue" });
}

export function clearEditDraft(): void {
  setState("editDraft", null);
}

/** Load text into the composer and focus it (used by the empty-state starter prompts). */
export function prefillComposer(text: string): void {
  setState("editDraft", text);
}

// ---- Attachments -----------------------------------------------------------

/** Ask the host to show the native file browser; results arrive as an `attachments` message. */
export function pickFiles(): void {
  post({ type: "pickFiles" });
}

/** Ask the host to stat dropped `file://` URIs (VS Code explorer / uri-list drags) into attachments. */
export function resolveDropped(uris: string[]): void {
  if (uris.length > 0) {
    post({ type: "resolveDropped", uris });
  }
}

/** Stage an in-memory attachment (OS drop or clipboard paste, where only bytes are available). */
export function addDataAttachment(
  name: string,
  mimeType: string,
  base64: string,
): void {
  setState("attachments", (staged) => [
    ...staged,
    {
      id: crypto.randomUUID(),
      name,
      kind: mimeType.startsWith("image/") ? "image" : "file",
      data: base64,
      mimeType,
    },
  ]);
}

export function removeAttachment(id: string): void {
  setState("attachments", (staged) =>
    staged.filter((attachment) => attachment.id !== id),
  );
}

/** Open/preview an attachment in the editor (host resolves path vs in-memory data). */
export function openAttachment(attachment: AttachmentInfo): void {
  // Copy to a plain object: `attachment` is usually a Solid store Proxy,
  // which postMessage's structured clone rejects with a DataCloneError.
  post({ type: "openAttachment", attachment: { ...attachment } });
}

/** Open a link clicked inside rendered Markdown (host routes file paths to the editor, URLs to the OS browser). */
export function openLink(href: string): void {
  post({ type: "openLink", href });
}

export function setConfigOption(
  configId: string,
  value: string | boolean,
  isBoolean = false,
): void {
  post({ type: "setConfigOption", configId, value, boolean: isBoolean });
}

export function respondToPermission(
  requestId: string,
  optionId: string,
  optionName: string,
): void {
  post({ type: "permissionResponse", requestId, optionId });
  resolvePermission(requestId, `Responded: ${optionName}`);
}

export function editAction(
  action: "diff" | "keep" | "undo" | "keepAll" | "undoAll",
  path?: string,
): void {
  post({ type: "editAction", action, path });
}

/** Estimated token count for a thought block, used once it's finalized (no server-side reasoning token count is available). */
export function thoughtTokenEstimate(text: string): number {
  return estimateTokens(text);
}

// ---- Sessions panel --------------------------------------------------------

/** Open the Sessions overlay and ask the host for a fresh list. */
export function openSessionsPanel(): void {
  setState("sessionsOpen", true);
  post({ type: "listSessions" });
}

export function closeSessionsPanel(): void {
  setState("sessionsOpen", false);
  post({ type: "sessionsClosed" });
}

/** Load a persisted session into the panel (host replays its history). */
export function openSessionRow(row: SessionRowInfo): void {
  closeSessionsPanel();
  if (row.current) {
    return;
  }
  post({
    type: "openSession",
    sessionId: row.sessionId,
    cwd: row.cwd,
    title: row.title,
  });
}

/** Delete one persisted session (host asks for confirmation, then refreshes the list). */
export function deleteSessionRow(row: SessionRowInfo): void {
  post({ type: "deleteSession", sessionId: row.sessionId, title: row.title });
}

/** Start a fresh session from the Sessions overlay. */
export function newChatFromPanel(): void {
  closeSessionsPanel();
  post({ type: "newChat" });
}
