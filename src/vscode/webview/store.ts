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
  ModelRetryInfo,
  OutboundMessage,
  PermissionOptionInfo,
  PlanEditorStateInfo,
  QueuedPromptInfo,
  SessionRowInfo,
  TabInfo,
  TokenTotals,
  WebviewRoute,
} from "../src/shared/protocol";
import type {
  ConfigEditorStateInfo,
  InstructionsEditorStateInfo,
  McpEditorStateInfo,
  SkillsViewStateInfo,
} from "../src/shared/settings";
import { initialRoute, onHostMessage, post } from "./lib/vscode-api";
import { estimateTokens } from "./lib/format";

export type ToolCallStatusUi =
  "pending" | "in_progress" | "completed" | "failed";

export type TranscriptItem =
  | { kind: "user"; id: string; text: string; attachments?: AttachmentInfo[] }
  | { kind: "assistant"; id: string; text: string; copied?: boolean }
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
      question?: boolean;
      resolvedNote: string | null;
    }
  | {
      kind: "retry";
      id: string;
      retryInSeconds: number;
      attempt: number;
      maxAttempts: number;
      error: string;
      errorDetail?: string;
    }
  | { kind: "error"; id: string; message: string };

export type Activity =
  | { type: "idle" }
  | { type: "thinking" }
  | { type: "streaming" }
  | { type: "tool"; title: string };

type SessionUiState = {
  items: TranscriptItem[];
  busy: boolean;
  promptStartedAt: number | null;
  activity: Activity;
  configOptions: SessionConfigOption[];
  commands: CommandInfo[];
  plan: PlanEntry[];
  edits: EditInfo[];
  usage: TokenTotals | null;
  context: ContextUsageInfo | null;
  cost: CostInfo | null;
  download: ModelDownloadInfo | null;
  retry: ModelRetryInfo | null;
  queue: QueuedPromptInfo[];
  editDraft: string | null;
  attachments: AttachmentInfo[];
  loadingSession: string | null;
};

type SessionRuntime = {
  hiddenToolCalls: Set<string>;
  openStreamId: string | null;
  openStreamKind: "assistant" | "thought" | null;
  openUserMessageId: string | null;
  openUserItemId: string | null;
  pendingPermissions: Set<string>;
  retryItemId: string | null;
};

interface State {
  route: WebviewRoute;
  planView: PlanEditorStateInfo | null;
  configEditorView: ConfigEditorStateInfo | null;
  mcpEditorView: McpEditorStateInfo | null;
  instructionsEditorView: InstructionsEditorStateInfo | null;
  skillsView: SkillsViewStateInfo | null;
  activeSessionId: string | null;
  tabs: TabInfo[];
  sessions: Record<string, SessionUiState>;
  sessionsOpen: boolean;
  persistedSessions: SessionRowInfo[];
}

function createSessionState(): SessionUiState {
  return {
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
    retry: null,
    queue: [],
    editDraft: null,
    attachments: [],
    loadingSession: null,
  };
}

function createRuntime(): SessionRuntime {
  return {
    hiddenToolCalls: new Set<string>(),
    openStreamId: null,
    openStreamKind: null,
    openUserMessageId: null,
    openUserItemId: null,
    pendingPermissions: new Set<string>(),
    retryItemId: null,
  };
}

const [state, setState] = createStore<State>({
  route: initialRoute,
  planView: null,
  configEditorView: null,
  mcpEditorView: null,
  instructionsEditorView: null,
  skillsView: null,
  activeSessionId: null,
  tabs: [],
  sessions: {},
  sessionsOpen: false,
  persistedSessions: [],
});

export { setState, state };

const runtimes = new Map<string, SessionRuntime>();

function activeSessionId(): string | null {
  return state.activeSessionId;
}

function ensureSession(sessionId: string): void {
  if (!state.sessions[sessionId]) {
    setState("sessions", sessionId, createSessionState());
  }
  if (!runtimes.has(sessionId)) {
    runtimes.set(sessionId, createRuntime());
  }
}

function getRuntime(sessionId: string): SessionRuntime {
  let runtime = runtimes.get(sessionId);
  if (!runtime) {
    runtime = createRuntime();
    runtimes.set(sessionId, runtime);
  }
  return runtime;
}

function activeSession(): SessionUiState {
  const sessionId = activeSessionId();
  return sessionId
    ? (state.sessions[sessionId] ?? createSessionState())
    : createSessionState();
}

export function activeTab(): TabInfo | null {
  const sessionId = activeSessionId();
  if (!sessionId) {
    return null;
  }
  return state.tabs.find((tab) => tab.sessionId === sessionId) ?? null;
}

export function isActiveSessionLoading(): boolean {
  const tab = activeTab();
  return Boolean(tab?.loading || sessionState().loadingSession);
}

export function sessionState(): SessionUiState {
  const sessionId = activeSessionId();
  if (!sessionId) {
    return createSessionState();
  }
  ensureSession(sessionId);
  return state.sessions[sessionId];
}

function pushItem(sessionId: string, item: TranscriptItem): void {
  ensureSession(sessionId);
  setState("sessions", sessionId, "items", (items) => [...items, item]);
}

function itemIndex(sessionId: string, id: string): number {
  return (state.sessions[sessionId]?.items ?? []).findIndex(
    (item) => item.id === id,
  );
}

function breakStream(sessionId: string): void {
  const runtime = getRuntime(sessionId);
  if (runtime.openStreamKind === "thought" && runtime.openStreamId) {
    finalizeThought(sessionId, runtime.openStreamId);
  }
  runtime.openStreamId = null;
  runtime.openStreamKind = null;
  runtime.openUserMessageId = null;
  runtime.openUserItemId = null;
}

function finalizeThought(sessionId: string, id: string): void {
  const index = itemIndex(sessionId, id);
  if (index === -1) {
    return;
  }
  setState("sessions", sessionId, "items", index, (item) =>
    item.kind === "thought" && item.finishedAt === null
      ? { ...item, finishedAt: Date.now() }
      : item,
  );
}

function addUserMessage(
  sessionId: string,
  text: string,
  attachments?: AttachmentInfo[],
): void {
  breakStream(sessionId);
  pushItem(sessionId, {
    kind: "user",
    id: crypto.randomUUID(),
    text,
    ...(attachments?.length ? { attachments } : {}),
  });
}

function appendToUserMessage(
  sessionId: string,
  messageId: string | undefined,
  part: { text?: string; attachment?: AttachmentInfo },
): void {
  ensureSession(sessionId);
  const runtime = getRuntime(sessionId);
  const isContinuation =
    messageId !== undefined &&
    messageId === runtime.openUserMessageId &&
    runtime.openUserItemId !== null &&
    itemIndex(sessionId, runtime.openUserItemId) !== -1;
  if (!isContinuation) {
    breakStream(sessionId);
    const id = crypto.randomUUID();
    pushItem(sessionId, { kind: "user", id, text: "" });
    runtime.openUserItemId = id;
    runtime.openUserMessageId = messageId ?? null;
  }
  setState(
    "sessions",
    sessionId,
    "items",
    itemIndex(sessionId, runtime.openUserItemId!),
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

type SessionUpdatePayload = Extract<
  OutboundMessage,
  { type: "update" }
>["update"];

type UserChunkContent = Extract<
  SessionUpdatePayload,
  { sessionUpdate: "user_message_chunk" }
>["content"];

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

function appendAssistantText(sessionId: string, text: string): void {
  ensureSession(sessionId);
  const runtime = getRuntime(sessionId);
  if (runtime.openStreamKind === "thought") {
    breakStream(sessionId);
  }
  if (runtime.openStreamKind !== "assistant") {
    const id = crypto.randomUUID();
    pushItem(sessionId, { kind: "assistant", id, text: "" });
    runtime.openStreamId = id;
    runtime.openStreamKind = "assistant";
  }
  const id = runtime.openStreamId!;
  setState(
    "sessions",
    sessionId,
    "items",
    itemIndex(sessionId, id),
    produce((item) => {
      if (item.kind === "assistant") {
        item.text += text;
      }
    }),
  );
  setState("sessions", sessionId, "activity", { type: "streaming" });
}

function appendThoughtText(sessionId: string, text: string): void {
  ensureSession(sessionId);
  const runtime = getRuntime(sessionId);
  if (runtime.openStreamKind === "assistant") {
    breakStream(sessionId);
  }
  if (runtime.openStreamKind !== "thought") {
    const id = crypto.randomUUID();
    pushItem(sessionId, {
      kind: "thought",
      id,
      text: "",
      startedAt: Date.now(),
      finishedAt: null,
    });
    runtime.openStreamId = id;
    runtime.openStreamKind = "thought";
  }
  const id = runtime.openStreamId!;
  setState(
    "sessions",
    sessionId,
    "items",
    itemIndex(sessionId, id),
    produce((item) => {
      if (item.kind === "thought") {
        item.text += text;
      }
    }),
  );
  setState("sessions", sessionId, "activity", { type: "thinking" });
}

function upsertToolCall(
  sessionId: string,
  update: {
    toolCallId: string;
    title?: string | null;
    kind?: string | null;
    status?: string | null;
    rawInput?: unknown;
    content?: ToolCallContent[] | null;
    _meta?: { [key: string]: unknown } | null;
  },
): void {
  ensureSession(sessionId);
  const runtime = getRuntime(sessionId);
  if (update.title === "update_todos") {
    runtime.hiddenToolCalls.add(update.toolCallId);
  }
  if (runtime.hiddenToolCalls.has(update.toolCallId)) {
    return;
  }
  breakStream(sessionId);
  const live = Boolean(update._meta?.["hoomanjs/live"]);
  const index = itemIndex(sessionId, update.toolCallId);
  if (index === -1) {
    pushItem(sessionId, {
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
      setState("sessions", sessionId, "activity", {
        type: "tool",
        title: update.title ?? "Tool",
      });
    }
    return;
  }
  setState(
    "sessions",
    sessionId,
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
  const current = state.sessions[sessionId]?.items[index];
  if (
    current?.kind === "tool" &&
    (update.status === "completed" || update.status === "failed")
  ) {
    setState("sessions", sessionId, "activity", { type: "idle" });
  } else if (current?.kind === "tool") {
    setState("sessions", sessionId, "activity", {
      type: "tool",
      title: current.title,
    });
  }
}

function upsertRetry(sessionId: string, retry: ModelRetryInfo | null): void {
  ensureSession(sessionId);
  const runtime = getRuntime(sessionId);
  if (!retry) {
    const id = runtime.retryItemId;
    if (id) {
      setState("sessions", sessionId, "items", (items) =>
        items.filter((item) => item.kind !== "retry" || item.id !== id),
      );
    }
    runtime.retryItemId = null;
    setState("sessions", sessionId, "retry", null);
    return;
  }
  const id = runtime.retryItemId ?? crypto.randomUUID();
  runtime.retryItemId = id;
  const nextItem: Extract<TranscriptItem, { kind: "retry" }> = {
    kind: "retry",
    id,
    retryInSeconds: retry.retryInSeconds,
    attempt: retry.nextAttempt,
    maxAttempts: retry.maxAttempts,
    error: retry.error,
    errorDetail: retry.errorDetail,
  };
  const index = itemIndex(sessionId, id);
  if (index === -1) {
    breakStream(sessionId);
    pushItem(sessionId, nextItem);
  } else {
    setState("sessions", sessionId, "items", index, nextItem);
  }
  setState("sessions", sessionId, "retry", retry);
}

function handleSessionUpdate(
  sessionId: string,
  update: SessionUpdatePayload,
): void {
  ensureSession(sessionId);
  switch (update.sessionUpdate) {
    case "user_message_chunk": {
      const part = userChunkToPart(update.content);
      if (part) {
        appendToUserMessage(sessionId, update.messageId ?? undefined, part);
      }
      break;
    }
    case "agent_message_chunk":
      if (update.content?.type === "text") {
        appendAssistantText(sessionId, update.content.text);
      }
      break;
    case "agent_thought_chunk":
      if (update.content?.type === "text") {
        appendThoughtText(sessionId, update.content.text);
      }
      break;
    case "tool_call":
    case "tool_call_update":
      upsertToolCall(sessionId, update);
      break;
    case "plan":
      setState("sessions", sessionId, "plan", update.entries ?? []);
      break;
    case "usage_update": {
      const tokens = update._meta?.["hoomanjs/tokens"] as
        TokenTotals | undefined;
      if (tokens) {
        setState("sessions", sessionId, "usage", tokens);
      }
      setState(
        "sessions",
        sessionId,
        "context",
        update.size > 0 ? { used: update.used, size: update.size } : null,
      );
      setState(
        "sessions",
        sessionId,
        "cost",
        update.cost
          ? { amount: update.cost.amount, currency: update.cost.currency }
          : null,
      );
      break;
    }
    case "available_commands_update":
      setState(
        "sessions",
        sessionId,
        "commands",
        update.availableCommands ?? [],
      );
      break;
    default:
      break;
  }
}

function showPermission(
  sessionId: string,
  msg: Extract<OutboundMessage, { type: "permission" }>,
): void {
  ensureSession(sessionId);
  const runtime = getRuntime(sessionId);
  breakStream(sessionId);
  runtime.pendingPermissions.add(msg.requestId);
  pushItem(sessionId, {
    kind: "permission",
    id: msg.requestId,
    title: msg.title,
    detail: msg.detail,
    options: msg.options,
    question: msg.question,
    resolvedNote: null,
  });
}

function resolvePermission(
  sessionId: string,
  requestId: string,
  note?: string,
): void {
  ensureSession(sessionId);
  getRuntime(sessionId).pendingPermissions.delete(requestId);
  const index = itemIndex(sessionId, requestId);
  if (index === -1) {
    return;
  }
  setState(
    "sessions",
    sessionId,
    "items",
    index,
    produce((item) => {
      if (item.kind === "permission") {
        item.resolvedNote = note ?? "Responded";
      }
    }),
  );
}

function clearChat(sessionId: string): void {
  ensureSession(sessionId);
  const runtime = getRuntime(sessionId);
  runtime.hiddenToolCalls.clear();
  runtime.openStreamId = null;
  runtime.openStreamKind = null;
  runtime.openUserMessageId = null;
  runtime.openUserItemId = null;
  runtime.pendingPermissions.clear();
  runtime.retryItemId = null;
  setState("sessions", sessionId, createSessionState());
}

onHostMessage((msg) => {
  switch (msg.type) {
    case "state":
      ensureSession(msg.sessionId);
      setState(
        "sessions",
        msg.sessionId,
        produce((session) => {
          session.configOptions = msg.configOptions;
          session.commands = msg.commands;
          session.busy = msg.busy;
          session.queue = msg.queue;
        }),
      );
      break;
    case "tabs":
      setState({ tabs: msg.tabs, activeSessionId: msg.activeSessionId });
      for (const tab of msg.tabs) {
        ensureSession(tab.sessionId);
        setState(
          "sessions",
          tab.sessionId,
          produce((session) => {
            session.busy = tab.busy;
            session.loadingSession = tab.loading
              ? (session.loadingSession ?? tab.title ?? "Starting session")
              : null;
          }),
        );
      }
      break;
    case "route":
      setState("route", msg.route);
      break;
    case "planState":
      setState("planView", msg.state);
      break;
    case "configEditorState":
      setState("configEditorView", msg.state);
      break;
    case "mcpEditorState":
      setState("mcpEditorView", msg.state);
      break;
    case "instructionsEditorState":
      setState("instructionsEditorView", msg.state);
      break;
    case "skillsViewState":
      setState("skillsView", msg.state);
      break;
    case "configOptions":
      ensureSession(msg.sessionId);
      setState(
        "sessions",
        msg.sessionId,
        produce((session) => {
          session.configOptions = msg.configOptions;
          // Receiving config options means the session finished bootstrapping
          // (session/new or session/load resolved), so clear any lingering
          // loading overlay even if a sessionLoading:false / tabs update was
          // missed during the placeholder -> real session handoff.
          session.loadingSession = null;
        }),
      );
      break;
    case "update":
      handleSessionUpdate(msg.sessionId, msg.update);
      break;
    case "promptStart":
      ensureSession(msg.sessionId);
      setState("sessions", msg.sessionId, {
        ...state.sessions[msg.sessionId],
        busy: true,
        promptStartedAt: Date.now(),
        activity: { type: "thinking" },
      });
      break;
    case "promptEnd":
      ensureSession(msg.sessionId);
      breakStream(msg.sessionId);
      setState(
        "sessions",
        msg.sessionId,
        produce((session) => {
          session.busy = false;
          session.promptStartedAt = null;
          session.activity = { type: "idle" };
          session.download = null;
          session.retry = null;
        }),
      );
      upsertRetry(msg.sessionId, null);
      break;
    case "download":
      ensureSession(msg.sessionId);
      setState("sessions", msg.sessionId, "download", msg.download);
      break;
    case "retry":
      upsertRetry(msg.sessionId, msg.retry);
      break;
    case "permission":
      showPermission(msg.sessionId, msg);
      break;
    case "permissionResolved":
      resolvePermission(msg.sessionId, msg.requestId, msg.note);
      break;
    case "clear":
      clearChat(msg.sessionId);
      break;
    case "edits":
      ensureSession(msg.sessionId);
      setState("sessions", msg.sessionId, "edits", msg.edits);
      break;
    case "queue":
      ensureSession(msg.sessionId);
      setState("sessions", msg.sessionId, "queue", msg.items);
      break;
    case "queueEditText":
      ensureSession(msg.sessionId);
      if (msg.attachments?.length) {
        setState("sessions", msg.sessionId, "attachments", (staged) => [
          ...staged,
          ...msg.attachments!,
        ]);
      }
      setState("sessions", msg.sessionId, "editDraft", msg.text);
      break;
    case "attachments":
      ensureSession(msg.sessionId);
      setState("sessions", msg.sessionId, "attachments", (staged) => [
        ...staged,
        ...msg.attachments,
      ]);
      break;
    case "sessions":
      setState("persistedSessions", msg.sessions);
      break;
    case "showSessions":
      setState("sessionsOpen", true);
      break;
    case "sessionLoading":
      ensureSession(msg.sessionId);
      setState(
        "sessions",
        msg.sessionId,
        "loadingSession",
        msg.loading ? (msg.title ?? "Loading session") : null,
      );
      break;
    case "error":
      ensureSession(msg.sessionId);
      breakStream(msg.sessionId);
      pushItem(msg.sessionId, {
        kind: "error",
        id: crypto.randomUUID(),
        message: msg.message,
      });
      setState(
        "sessions",
        msg.sessionId,
        produce((session) => {
          session.busy = false;
          session.promptStartedAt = null;
          session.activity = { type: "idle" };
          session.download = null;
          session.retry = null;
        }),
      );
      upsertRetry(msg.sessionId, null);
      break;
    default:
      break;
  }
});

post({ type: "ready" });

export function submitPrompt(text: string): void {
  const sessionId = activeSessionId();
  if (!sessionId) {
    return;
  }
  ensureSession(sessionId);
  const session = activeSession();
  const trimmed = text.trim();
  const attachments = session.attachments.map((attachment) => ({
    ...attachment,
  }));
  if (!trimmed && attachments.length === 0) {
    return;
  }
  if (!session.busy) {
    addUserMessage(sessionId, trimmed, attachments);
  }
  setState("sessions", sessionId, "attachments", []);
  post({ type: "prompt", text: trimmed, attachments });
}

export function cancelPrompt(): void {
  post({ type: "cancel" });
}

export function queueDeletePrompt(id: string): void {
  post({ type: "queueDelete", id });
}

export function queueSendNow(id: string): void {
  post({ type: "queueSendNow", id });
}

export function queueEditPrompt(id: string): void {
  post({ type: "queueEdit", id });
}

export function steerQueue(): void {
  post({ type: "steerQueue" });
}

export function clearEditDraft(): void {
  const sessionId = activeSessionId();
  if (!sessionId) {
    return;
  }
  setState("sessions", sessionId, "editDraft", null);
}

export function prefillComposer(text: string): void {
  const sessionId = activeSessionId();
  if (!sessionId) {
    return;
  }
  setState("sessions", sessionId, "editDraft", text);
}

export function pickFiles(): void {
  post({ type: "pickFiles" });
}

export function resolveDropped(uris: string[]): void {
  if (uris.length > 0) {
    post({ type: "resolveDropped", uris });
  }
}

export function addDataAttachment(
  name: string,
  mimeType: string,
  base64: string,
): void {
  const sessionId = activeSessionId();
  if (!sessionId) {
    return;
  }
  ensureSession(sessionId);
  const next: AttachmentInfo = {
    id: crypto.randomUUID(),
    name,
    kind: mimeType.startsWith("image/") ? "image" : "file",
    data: base64,
    mimeType,
  };
  setState("sessions", sessionId, "attachments", [
    ...sessionState().attachments,
    next,
  ]);
}

export function removeAttachment(id: string): void {
  const sessionId = activeSessionId();
  if (!sessionId) {
    return;
  }
  setState("sessions", sessionId, "attachments", (staged) =>
    staged.filter((attachment) => attachment.id !== id),
  );
}

export function openAttachment(attachment: AttachmentInfo): void {
  post({ type: "openAttachment", attachment: { ...attachment } });
}

export function openLink(href: string): void {
  post({ type: "openLink", href });
}

export function sendConfigEditorAction(
  action: import("../src/shared/settings").ConfigEditorAction,
): void {
  post({ type: "configEditorAction", action });
}

export function sendMcpEditorAction(
  action: import("../src/shared/settings").McpEditorAction,
): void {
  post({ type: "mcpEditorAction", action });
}

export function sendInstructionsEditorAction(
  action: import("../src/shared/settings").InstructionsEditorAction,
): void {
  post({ type: "instructionsEditorAction", action });
}

export function sendSkillsViewAction(
  action: import("../src/shared/settings").SkillsViewAction,
): void {
  post({ type: "skillsViewAction", action });
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
  const sessionId = activeSessionId();
  if (!sessionId) {
    return;
  }
  post({ type: "permissionResponse", requestId, optionId });
  resolvePermission(sessionId, requestId, `Responded: ${optionName}`);
}

export function editAction(
  action: "diff" | "keep" | "undo" | "keepAll" | "undoAll",
  path?: string,
): void {
  post({ type: "editAction", action, path });
}

export function thoughtTokenEstimate(text: string): number {
  return estimateTokens(text);
}

export function openSessionsPanel(): void {
  setState("sessionsOpen", true);
  post({ type: "listSessions" });
}

export function closeSessionsPanel(): void {
  setState("sessionsOpen", false);
  post({ type: "sessionsClosed" });
}

export function openSessionRow(row: SessionRowInfo): void {
  closeSessionsPanel();
  if (state.tabs.some((tab) => tab.sessionId === row.sessionId)) {
    activateTab(row.sessionId);
    return;
  }
  post({
    type: "openSession",
    sessionId: row.sessionId,
    cwd: row.cwd,
    title: row.title,
  });
}

export function deleteSessionRow(row: SessionRowInfo): void {
  post({ type: "deleteSession", sessionId: row.sessionId, title: row.title });
}

export function newChatFromPanel(): void {
  closeSessionsPanel();
  post({ type: "newChat" });
}

export function forkChatFromPanel(): void {
  post({ type: "forkChat" });
}

export function setAssistantCopied(id: string, copied: boolean): void {
  const sessionId = activeSessionId();
  if (!sessionId) {
    return;
  }
  const index = itemIndex(sessionId, id);
  if (index === -1) {
    return;
  }
  setState(
    "sessions",
    sessionId,
    "items",
    index,
    produce((item) => {
      if (item.kind === "assistant") {
        item.copied = copied;
      }
    }),
  );
}

export function latestCompletedAssistantId(
  sessionId?: string | null,
): string | null {
  const target = sessionId ?? activeSessionId();
  if (!target) {
    return null;
  }
  const items = state.sessions[target]?.items ?? [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === "assistant") {
      return item.id;
    }
  }
  return null;
}

export function activateTab(sessionId: string): void {
  post({ type: "activateTab", sessionId });
}

export function closeTab(sessionId: string): void {
  post({ type: "closeTab", sessionId });
}
