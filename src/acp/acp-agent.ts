import path from "node:path";
import { readFile } from "node:fs/promises";
import { Readable, Writable } from "node:stream";
import { stdin, stdout } from "node:process";
import {
  agent as acpAgent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type AgentApp,
  type AgentConnection,
  type AgentContext,
  type CancelNotification,
  type DeleteSessionRequest,
  type FileSystemCapabilities,
  type InitializeRequest,
  type InitializeResponse,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
  type SessionInfo,
  type SessionModeState,
  type SessionNotification,
  type SetSessionConfigOptionRequest,
  type SetSessionConfigOptionResponse,
  type SetSessionModeRequest,
  type SetSessionModeResponse,
  type StopReason,
  type ToolCallContent,
} from "@agentclientprotocol/sdk";
import {
  isModelStreamEvent,
  Message,
  ModelStreamUpdateEvent,
  type Agent as StrandsAgent,
  type MessageData,
  type StopReason as StrandsStopReason,
} from "@strands-agents/sdk";
import { bootstrap } from "../core/index.js";
import { applySessionMode } from "../core/agent/sync-tool-registry-mode.js";
import { MODE_DEFINITIONS } from "../core/modes/definitions.js";
import {
  DEFAULT_SESSION_MODE,
  isKnownSessionMode,
  type SessionMode,
} from "../core/modes/schema.js";
import { getModeState, setSessionMode } from "../core/state/session-mode.js";
import { isYoloEnabled, setYoloEnabled } from "../core/state/yolo.js";
import {
  getAgentConversationManager,
  getAgentSessionManager,
} from "../core/agent/index.js";
import { readBundledPrompt } from "../core/prompts/bundled.js";
import { formatModeNames } from "../core/modes/definitions.js";
import { modelProviders } from "../core/models/index.js";
import {
  buildSessionConfigOptions,
  currentModelName,
  CONFIG_ID_EFFORT,
  CONFIG_ID_MODE,
  CONFIG_ID_MODEL,
} from "./session-config.js";
import {
  activeProviderName,
  currentReasoningEffort,
  parseReasoningEffortArg,
  REASONING_EFFORT_LEVELS,
  REASONING_EFFORT_OFF,
  withReasoningEffort,
} from "../core/models/reasoning-effort.js";
import {
  ACP_SLASH_COMMANDS,
  parseAcpSlashCommand,
  parseYoloToggle,
  type ParsedSlashCommand,
} from "./commands.js";
import {
  ENTER_PLAN_MODE_TOOL,
  EXIT_PLAN_MODE_TOOL,
} from "../core/state/tool-approvals.js";
import { runWithCwd } from "../core/utils/cwd-context.js";
import { runWithAgentMemoryScope } from "../core/memory/index.js";
import {
  consumeExitRequest,
  EXIT_REQUESTED_CODE,
} from "../core/state/exit-request.js";
import {
  createSessionConfig,
  type SessionConfig,
} from "../core/session-config.js";
import { acpSessionsRootPath } from "./utils/paths.js";
import { inferToolKind } from "./utils/tool-kind.js";
import {
  fileToolDiffContent,
  toolResultToAcpContent,
} from "./utils/tool-result-content.js";
import { toolCallLocationsFromInput } from "./utils/tool-locations.js";
import { takeFileToolDisplay } from "../core/state/file-tool-display.js";
import { getTodoViewState } from "../core/state/todos.js";
import { UPDATE_TODOS_TOOL_NAME } from "../core/tools/todo.js";
import { setTextFsBackend } from "../core/tools/text-fs-backend.js";
import {
  setTerminalBackend,
  type TerminalRunRequest,
  type TerminalRunResult,
} from "../core/tools/terminal-backend.js";
import { createAcpToolApprovalIntervention } from "./approvals.js";
import { extractAcpClientUserId } from "./meta/user-id.js";
import { deriveSessionTitleFromEcho } from "./sessions/title.js";
import { acpPromptEchoText, acpPromptToInvokeArgs } from "./prompt-invoke.js";
import { normalizeAcpSessionMcpServers } from "./mcp-servers.js";
import { replayConversationHistory } from "./sessions/replay.js";
import {
  deleteStoredSession,
  listStoredSessionIds,
  loadSessionMessages,
  patchSessionMeta,
  readSessionMeta,
  saveSessionMessages,
  toSessionInfo,
  writeSessionMeta,
  type SessionMetaFile,
} from "./sessions/store.js";

/** Max sessions returned per `session/list` page. */
const LIST_PAGE_SIZE = 40;

/** Fallback when a session record is missing (never mutate). */
const EMPTY_STREAMED_TOOL_CALL_IDS: ReadonlySet<string> = new Set<string>();

/** Prompt injected by the `/init` slash command (generates AGENTS.md). */
const INIT_AGENTS_PROMPT = readBundledPrompt("static", "init.md");

/** Name + version reported to the client in `agentInfo`. */
type AgentIdentity = { name: string; version: string };

/** In-memory state for one active session. */
type SessionRecord = {
  cwd: string;
  agent: StrandsAgent;
  config: SessionConfig;
  mcpDisconnect: () => Promise<void>;
  /** Aborts the in-flight prompt turn (set for the turn's duration). */
  turnAbort: AbortController | null;
  /** Chains `prompt` turns so concurrent RPCs for the same session serialize. */
  promptExclusive: Promise<void>;
  /** Tool calls that already received `tool_call` from the model stream this turn. */
  streamedToolCallIds: Set<string>;
  /** Incremental JSON fragments for `toolUseInputDelta` keyed by `toolUseId`. */
  streamingToolInputJson: Map<string, string>;
  /** Latest tool use block seen in the model stream (sequential tool calls). */
  lastStreamToolUseId: string | null;
  /**
   * Terminal id embedded for a shell tool call routed through the client's
   * `terminal/*` backend, keyed by `toolUseId`. Lets the completed tool-call
   * update keep showing the live terminal instead of a JSON result blob.
   */
  terminalByToolCall: Map<string, string>;
  /** Re-apply the mode tool surface at the next turn boundary (deferred mid-turn). */
  pendingModeReapply: boolean;
  /** Rebuild the model at the next turn boundary (deferred mid-turn). */
  pendingModelRebuild: boolean;
  /** Persist this default model to shared config after a deferred rebuild. */
  pendingPersistModel: string | null;
  /** Persist this provider's effort to shared config after a deferred rebuild. */
  pendingPersistEffort: { provider: string; effort: string | undefined } | null;
};

async function readAgentIdentity(): Promise<AgentIdentity> {
  const packageUrl = new URL("../../package.json", import.meta.url);
  const pkg = JSON.parse(await readFile(packageUrl, "utf8")) as {
    bin?: string | Record<string, string>;
    name?: string;
    version?: string;
  };
  const binName =
    pkg.bin && typeof pkg.bin === "object"
      ? Object.keys(pkg.bin)[0]
      : undefined;
  return {
    name: binName ?? pkg.name ?? "hooman",
    version: pkg.version ?? "0.0.0",
  };
}

/** Clamp the client's requested protocol version to what we implement. */
function negotiateProtocolVersion(clientVersion: number): number {
  if (!Number.isFinite(clientVersion) || clientVersion < 1) {
    return PROTOCOL_VERSION;
  }
  return Math.min(clientVersion, PROTOCOL_VERSION);
}

/** Opaque `session/list` cursor: base64-encoded `{ offset }`. */
function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64");
}

function decodeCursor(cursor: string): number {
  try {
    const raw = Buffer.from(cursor, "base64").toString("utf8");
    const parsed = JSON.parse(raw) as { offset?: unknown };
    if (
      typeof parsed.offset === "number" &&
      Number.isInteger(parsed.offset) &&
      parsed.offset >= 0
    ) {
      return parsed.offset;
    }
  } catch {
    /* fall through to the error below */
  }
  throw RequestError.invalidParams({
    cursor,
    message: "Invalid pagination cursor",
  });
}

function assertAbsolutePath(value: string, field: string): void {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw RequestError.invalidParams({
      [field]: value,
      message: `${field} must be a non-empty absolute path`,
    });
  }
  if (!path.isAbsolute(trimmed)) {
    throw RequestError.invalidParams({
      [field]: value,
      message: `${field} must be an absolute path`,
    });
  }
}

/** Best-effort parse of a streamed tool-input JSON fragment. */
function parseStreamingToolJson(buffer: string): unknown {
  try {
    return JSON.parse(buffer) as unknown;
  } catch {
    return { _partialJson: buffer };
  }
}

/** Whether a thrown error represents cooperative cancellation, not a failure. */
function isCancellationError(
  err: unknown,
  cancelSignals: readonly AbortSignal[],
): boolean {
  if (cancelSignals.some((s) => s.aborted)) {
    return true;
  }
  if (!err || typeof err !== "object") {
    return false;
  }
  const e = err as { name?: string };
  return e.name === "AbortError" || e.name === "CancelledError";
}

/** Map a Strands stop reason onto the ACP {@link StopReason} vocabulary. */
function toAcpStopReason(reason: StrandsStopReason): StopReason {
  switch (reason) {
    case "cancelled":
      return "cancelled";
    case "maxTokens":
    case "modelContextWindowExceeded":
      return "max_tokens";
    case "contentFiltered":
    case "guardrailIntervened":
      return "refusal";
    case "endTurn":
    case "toolUse":
    case "stopSequence":
    default:
      return "end_turn";
  }
}

function serializeAgentMessages(agent: StrandsAgent): MessageData[] {
  return agent.messages.map((m) => m.toJSON());
}

/** Normalize a persisted/requested mode to a known id, else the default. */
function resolveSessionMode(mode: SessionMode | undefined): SessionMode {
  return mode && isKnownSessionMode(mode) ? mode : DEFAULT_SESSION_MODE;
}

/** The ACP `SessionModeState` advertised for a session's current mode. */
function buildSessionModeState(currentModeId: SessionMode): SessionModeState {
  return {
    currentModeId,
    availableModes: MODE_DEFINITIONS.map((mode) => ({
      id: mode.id,
      name: mode.name,
      description: mode.description,
    })),
  };
}

/**
 * Hooman's ACP agent, built on the app-style SDK API.
 *
 * Implements initialization, session setup (`session/new`, `session/load`),
 * session discovery (`session/list`, `session/delete`), and the full prompt
 * turn (`session/prompt` streaming + `session/cancel`).
 */
export class HoomanAcpAgent {
  readonly #identity: AgentIdentity;
  readonly #acpRoot = acpSessionsRootPath();
  readonly #sessions = new Map<string, SessionRecord>();
  /** Connection-scoped outbound context, captured in {@link onConnect}. */
  #client: AgentContext | null = null;
  #connectionSignal: AbortSignal | null = null;
  /** Client filesystem capabilities from `initialize` (gates `fs/*` calls). */
  #clientFsCaps: FileSystemCapabilities | null = null;
  /** Whether the client supports `terminal/*` methods (gates the shell tool). */
  #clientTerminalCap = false;

  constructor(identity: AgentIdentity) {
    this.#identity = identity;
  }

  /** Bind connection-scoped lifecycle: capture the client + dispose on close. */
  onConnect(connection: AgentConnection): void {
    this.#client = connection.client;
    this.#connectionSignal = connection.signal;
    if (connection.signal.aborted) {
      void this.#disposeAll();
      return;
    }
    connection.signal.addEventListener(
      "abort",
      () => {
        void this.#disposeAll();
      },
      { once: true },
    );
  }

  initialize(params: InitializeRequest): InitializeResponse {
    this.#clientFsCaps = params.clientCapabilities?.fs ?? null;
    this.#clientTerminalCap = params.clientCapabilities?.terminal === true;
    return {
      protocolVersion: negotiateProtocolVersion(params.protocolVersion),
      agentInfo: {
        name: this.#identity.name,
        title: this.#identity.name,
        version: this.#identity.version,
      },
      authMethods: [],
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: {
          image: true,
          audio: true,
          embeddedContext: true,
        },
        mcpCapabilities: {
          http: true,
          sse: true,
        },
        sessionCapabilities: {
          list: {},
          delete: {},
        },
      },
    };
  }

  async listSessions(
    params: ListSessionsRequest,
  ): Promise<ListSessionsResponse> {
    const ids = await listStoredSessionIds(this.#acpRoot);
    const sessions: SessionInfo[] = [];
    for (const id of ids) {
      const info = await toSessionInfo(this.#acpRoot, id);
      if (info && (!params.cwd || info.cwd === params.cwd)) {
        sessions.push(info);
      }
    }
    sessions.sort((a, b) =>
      String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")),
    );

    const offset = params.cursor ? decodeCursor(params.cursor) : 0;
    const page = sessions.slice(offset, offset + LIST_PAGE_SIZE);
    const nextOffset = offset + LIST_PAGE_SIZE;
    const nextCursor =
      nextOffset < sessions.length ? encodeCursor(nextOffset) : null;

    return { sessions: page, nextCursor };
  }

  async deleteSession(params: DeleteSessionRequest): Promise<void> {
    const record = this.#sessions.get(params.sessionId);
    if (record) {
      this.#sessions.delete(params.sessionId);
      record.turnAbort?.abort();
      await record.mcpDisconnect();
    }
    await deleteStoredSession(this.#acpRoot, params.sessionId);
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    assertAbsolutePath(params.cwd, "cwd");
    const sessionId = crypto.randomUUID();
    const clientUserId = extractAcpClientUserId(params._meta) ?? null;
    const mcpServers = normalizeAcpSessionMcpServers(params.mcpServers);

    const mode = DEFAULT_SESSION_MODE;
    const now = new Date().toISOString();
    const meta: SessionMetaFile = {
      cwd: params.cwd,
      createdAt: now,
      updatedAt: now,
      title: null,
      userId: clientUserId,
      mcpServers,
      sessionMode: mode,
    };
    await writeSessionMeta(this.#acpRoot, sessionId, meta);

    const record = await this.#bootstrapSession(
      sessionId,
      params.cwd,
      clientUserId ?? sessionId,
      mcpServers,
      mode,
    );
    this.#sessions.set(sessionId, record);
    await this.#advertiseCommands(this.#requireClient(), sessionId);

    return {
      sessionId,
      modes: buildSessionModeState(mode),
      configOptions: buildSessionConfigOptions(record.config, mode),
    };
  }

  async loadSession(
    params: LoadSessionRequest,
    client: AgentContext,
  ): Promise<LoadSessionResponse> {
    if (this.#sessions.has(params.sessionId)) {
      throw RequestError.invalidParams({
        sessionId: params.sessionId,
        message: "Session is already active in this agent process.",
      });
    }
    const existing = await readSessionMeta(this.#acpRoot, params.sessionId);
    if (!existing) {
      throw RequestError.resourceNotFound(`session:${params.sessionId}`);
    }
    assertAbsolutePath(params.cwd, "cwd");

    const fromRequest = extractAcpClientUserId(params._meta);
    const clientUserId =
      fromRequest !== undefined ? fromRequest : (existing.userId ?? null);
    const mcpServers =
      params.mcpServers.length > 0
        ? normalizeAcpSessionMcpServers(params.mcpServers)
        : (existing.mcpServers ?? []);
    const mode = resolveSessionMode(existing.sessionMode);

    const record = await this.#bootstrapSession(
      params.sessionId,
      params.cwd,
      clientUserId ?? params.sessionId,
      mcpServers,
      mode,
      existing.model,
    );

    const saved = await loadSessionMessages(this.#acpRoot, params.sessionId);
    record.agent.messages.length = 0;
    for (const md of saved) {
      record.agent.messages.push(Message.fromJSON(md));
    }

    await replayConversationHistory(
      client,
      params.sessionId,
      record.agent.messages,
    );

    this.#sessions.set(params.sessionId, record);

    await patchSessionMeta(this.#acpRoot, params.sessionId, {
      cwd: params.cwd,
      ...(fromRequest !== undefined ? { userId: fromRequest || null } : {}),
      mcpServers,
      sessionMode: mode,
    });

    await this.#advertiseCommands(client, params.sessionId);
    // Surface any restored plan so a resumed session shows its todo list.
    if (getTodoViewState(record.agent).total > 0) {
      await this.#sendPlanUpdate(client, params.sessionId, record);
    }

    return {
      modes: buildSessionModeState(mode),
      configOptions: buildSessionConfigOptions(record.config, mode),
    };
  }

  /** Advertise the available slash commands for a freshly set-up session. */
  #advertiseCommands(client: AgentContext, sessionId: string): Promise<void> {
    return this.#sendUpdate(client, sessionId, {
      sessionUpdate: "available_commands_update",
      availableCommands: [...ACP_SLASH_COMMANDS],
    });
  }

  /**
   * Handle `session/set_mode`: switch the active mode for a running session,
   * re-applying the tool surface and persisting the choice.
   */
  async setSessionMode(
    params: SetSessionModeRequest,
  ): Promise<SetSessionModeResponse> {
    const rec = this.#sessions.get(params.sessionId);
    if (!rec) {
      throw RequestError.invalidParams({ sessionId: params.sessionId });
    }
    if (!isKnownSessionMode(params.modeId)) {
      throw RequestError.invalidParams({
        modeId: params.modeId,
        message: `Unknown mode "${params.modeId}"`,
      });
    }
    if (this.#transitionMode(rec, params.modeId)) {
      await patchSessionMeta(this.#acpRoot, params.sessionId, {
        sessionMode: params.modeId,
      });
    }
    return {};
  }

  /**
   * Handle `session/set_config_option`: apply a model or mode selection and
   * return the complete, up-to-date configuration state (as the spec requires).
   */
  async setSessionConfigOption(
    params: SetSessionConfigOptionRequest,
  ): Promise<SetSessionConfigOptionResponse> {
    const rec = this.#sessions.get(params.sessionId);
    if (!rec) {
      throw RequestError.invalidParams({ sessionId: params.sessionId });
    }
    if (typeof params.value !== "string") {
      throw RequestError.invalidParams({
        configId: params.configId,
        message: `Config option "${params.configId}" expects a string value`,
      });
    }
    const value = params.value;

    if (params.configId === CONFIG_ID_MODE) {
      if (!isKnownSessionMode(value)) {
        throw RequestError.invalidParams({
          value,
          message: `Unknown mode "${value}"`,
        });
      }
      if (this.#transitionMode(rec, value)) {
        await patchSessionMeta(this.#acpRoot, params.sessionId, {
          sessionMode: value,
        });
      }
    } else if (params.configId === CONFIG_ID_MODEL) {
      await this.#applyModelChange(rec, value);
      await patchSessionMeta(this.#acpRoot, params.sessionId, { model: value });
    } else if (params.configId === CONFIG_ID_EFFORT) {
      const parsed = parseReasoningEffortArg(value);
      if (!parsed) {
        throw RequestError.invalidParams({
          value,
          message: `Unknown reasoning effort "${value}"`,
        });
      }
      await this.#applyEffortChange(rec, parsed.value);
    } else {
      throw RequestError.invalidParams({
        configId: params.configId,
        message: `Unknown config option "${params.configId}"`,
      });
    }

    return {
      configOptions: buildSessionConfigOptions(
        rec.config,
        resolveSessionMode(getModeState(rec.agent).mode),
      ),
    };
  }

  /** Whether a prompt turn is currently streaming for this session. */
  #isTurnActive(rec: SessionRecord): boolean {
    return rec.turnAbort !== null;
  }

  /**
   * Switch the session mode. Records it immediately (so state reads are
   * correct), but defers the tool-surface rebuild to the next turn boundary
   * when a turn is streaming, avoiding a mid-turn tool-surface swap. Returns
   * whether the mode actually changed.
   */
  #transitionMode(rec: SessionRecord, mode: SessionMode): boolean {
    if (resolveSessionMode(getModeState(rec.agent).mode) === mode) {
      return false;
    }
    setSessionMode(rec.agent, mode);
    if (this.#isTurnActive(rec)) {
      rec.pendingModeReapply = true;
    } else {
      applySessionMode(rec.agent);
    }
    return true;
  }

  /**
   * Select a new model for the session. Flips the in-memory (ephemeral) config
   * default immediately, then rebuilds the live model — deferring the rebuild
   * to the next turn boundary when a turn is streaming.
   */
  async #applyModelChange(
    rec: SessionRecord,
    modelName: string,
  ): Promise<void> {
    const match = rec.config.llms.find((entry) => entry.name === modelName);
    if (!match) {
      throw RequestError.invalidParams({
        value: modelName,
        message: `Unknown model "${modelName}"`,
      });
    }
    if (match.name === currentModelName(rec.config)) {
      return;
    }
    const previous = currentModelName(rec.config);
    rec.config.update({
      llms: rec.config.llms.map((entry) => ({
        ...entry,
        default: entry.name === match.name,
      })),
    });
    if (this.#isTurnActive(rec)) {
      rec.pendingModelRebuild = true;
      rec.pendingPersistModel = match.name;
      return;
    }
    await this.#rebuildModel(rec, previous);
    this.#persistDefaultModel(rec, match.name);
  }

  /**
   * Persist the default-model choice to the shared on-disk config so it becomes
   * the default for future sessions (mirrors the chat TUI's `/model`). Skips
   * models that only exist in a project overlay.
   */
  #persistDefaultModel(rec: SessionRecord, modelName: string): void {
    rec.config.persistToDisk((base) =>
      base.llms.some((entry) => entry.name === modelName)
        ? {
            llms: base.llms.map((entry) => ({
              ...entry,
              default: entry.name === modelName,
            })),
          }
        : null,
    );
  }

  /**
   * Persist a provider's reasoning effort to the shared on-disk config
   * (recomputed against the base provider so its other reasoning keys stay
   * intact). Skips providers that only exist in a project overlay.
   */
  #persistProviderEffort(
    rec: SessionRecord,
    providerName: string,
    effort: string | undefined,
  ): void {
    rec.config.persistToDisk((base) =>
      base.providers.some((entry) => entry.name === providerName)
        ? {
            providers: base.providers.map((entry) =>
              entry.name === providerName
                ? {
                    ...entry,
                    options: withReasoningEffort(entry.options, effort),
                  }
                : entry,
            ) as typeof base.providers,
          }
        : null,
    );
  }

  /**
   * Set the reasoning effort for the session's active model provider. Flips the
   * in-memory (ephemeral) provider option immediately, then rebuilds the live
   * model — deferring the rebuild to the next turn boundary during a turn — and
   * persists the change to the shared config (mirrors the chat TUI).
   */
  async #applyEffortChange(
    rec: SessionRecord,
    effort: string | undefined,
  ): Promise<void> {
    const providerName = activeProviderName(rec.config);
    if (!providerName) {
      throw RequestError.invalidParams({
        message: "No active model provider to set reasoning effort on.",
      });
    }
    const providerEntry = rec.config.providers.find(
      (entry) => entry.name === providerName,
    );
    if (!providerEntry) {
      throw RequestError.invalidParams({
        message: `Provider "${providerName}" is not configured.`,
      });
    }
    const previousProviders = rec.config.providers;
    rec.config.update({
      providers: rec.config.providers.map((entry) =>
        entry.name === providerName
          ? { ...entry, options: withReasoningEffort(entry.options, effort) }
          : entry,
      ) as typeof rec.config.providers,
    });
    if (this.#isTurnActive(rec)) {
      rec.pendingModelRebuild = true;
      rec.pendingPersistEffort = { provider: providerName, effort };
      return;
    }
    try {
      await this.#rebuildModel(rec);
    } catch (error) {
      rec.config.update({ providers: previousProviders });
      throw error;
    }
    this.#persistProviderEffort(rec, providerName, effort);
  }

  /** Rebuild the Strands model from current config, rolling back on failure. */
  async #rebuildModel(rec: SessionRecord, previous?: string): Promise<void> {
    try {
      const resolved = rec.config.llm;
      const provider = await modelProviders[resolved.provider]!();
      rec.agent.model = provider.create(
        resolved.providerOptions,
        resolved.llmOptions,
      );
    } catch (error) {
      if (previous) {
        rec.config.update({
          llms: rec.config.llms.map((entry) => ({
            ...entry,
            default: entry.name === previous,
          })),
        });
      }
      throw RequestError.internalError({
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Apply settings changes deferred during a turn (mode tool-surface + model
   * rebuild). Runs at the turn boundary before the next turn may start.
   */
  async #flushPendingSettings(rec: SessionRecord): Promise<void> {
    if (rec.pendingModeReapply) {
      rec.pendingModeReapply = false;
      applySessionMode(rec.agent);
    }
    if (rec.pendingModelRebuild) {
      rec.pendingModelRebuild = false;
      const persistModel = rec.pendingPersistModel;
      const persistEffort = rec.pendingPersistEffort;
      rec.pendingPersistModel = null;
      rec.pendingPersistEffort = null;
      const rebuilt = await this.#rebuildModel(rec).then(
        () => true,
        () => false,
      );
      if (rebuilt) {
        if (persistModel) {
          this.#persistDefaultModel(rec, persistModel);
        }
        if (persistEffort) {
          this.#persistProviderEffort(
            rec,
            persistEffort.provider,
            persistEffort.effort,
          );
        }
      }
    }
  }

  /**
   * Execute an inline (non-model) slash command and return the text reply to
   * stream back as an `agent_message_chunk`. `/init` is handled by the caller.
   */
  #runControlCommand(
    client: AgentContext,
    sessionId: string,
    rec: SessionRecord,
    command: ParsedSlashCommand,
  ): Promise<string> {
    switch (command.name) {
      case "mode":
        return this.#commandSetMode(client, sessionId, rec, command.args);
      case "model":
        return this.#commandSetModel(client, sessionId, rec, command.args);
      case "effort":
        return this.#commandSetEffort(client, sessionId, rec, command.args);
      case "yolo":
        return this.#commandSetYolo(sessionId, rec, command.args);
      case "compact":
        return this.#commandCompact(rec);
      default:
        return Promise.resolve(`Unknown command "/${command.name}".`);
    }
  }

  async #commandSetMode(
    client: AgentContext,
    sessionId: string,
    rec: SessionRecord,
    args: string,
  ): Promise<string> {
    const current = resolveSessionMode(getModeState(rec.agent).mode);
    const arg = args.trim().toLowerCase();
    if (!arg) {
      return `Usage: /mode <${formatModeNames()}>. Current mode: "${current}".`;
    }
    if (!isKnownSessionMode(arg)) {
      return `Unknown mode "${arg}". Use ${formatModeNames()}.`;
    }
    if (!this.#transitionMode(rec, arg)) {
      return `Already in "${arg}" mode.`;
    }
    await this.#syncCurrentMode(client, sessionId, rec);
    return `Switched session mode to "${arg}".`;
  }

  async #commandSetModel(
    client: AgentContext,
    sessionId: string,
    rec: SessionRecord,
    args: string,
  ): Promise<string> {
    const arg = args.trim();
    if (!arg) {
      return this.#listModelsText(rec);
    }
    if (!rec.config.llms.some((entry) => entry.name === arg)) {
      return `Unknown model "${arg}".\n\n${this.#listModelsText(rec)}`;
    }
    if (arg === currentModelName(rec.config)) {
      return `Already using model "${arg}".`;
    }
    try {
      await this.#applyModelChange(rec, arg);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Could not switch to model "${arg}": ${message}`;
    }
    await patchSessionMeta(this.#acpRoot, sessionId, { model: arg });
    await this.#sendUpdate(client, sessionId, {
      sessionUpdate: "config_option_update",
      configOptions: buildSessionConfigOptions(
        rec.config,
        resolveSessionMode(getModeState(rec.agent).mode),
      ),
    });
    return `Switched model to "${arg}".`;
  }

  #listModelsText(rec: SessionRecord): string {
    const current = currentModelName(rec.config);
    const lines = rec.config.llms.map((entry) => {
      const marker = entry.name === current ? "*" : "-";
      return `${marker} ${entry.name} (${entry.provider}/${entry.options.model})`;
    });
    return [
      `Current model: ${current ?? "(none)"}`,
      "Available models:",
      ...lines,
      'Use "/model <name>" to switch.',
    ].join("\n");
  }

  async #commandSetEffort(
    client: AgentContext,
    sessionId: string,
    rec: SessionRecord,
    args: string,
  ): Promise<string> {
    const current = currentReasoningEffort(rec.config);
    const arg = args.trim();
    if (!arg) {
      return `Current reasoning effort: "${current ?? REASONING_EFFORT_OFF}". Use ${REASONING_EFFORT_LEVELS.join(
        ", ",
      )} or ${REASONING_EFFORT_OFF}.`;
    }
    const parsed = parseReasoningEffortArg(arg);
    if (!parsed) {
      return `Unknown effort "${arg}". Use ${REASONING_EFFORT_LEVELS.join(
        ", ",
      )} or ${REASONING_EFFORT_OFF}.`;
    }
    if (parsed.value === current) {
      return `Reasoning effort is already "${current ?? REASONING_EFFORT_OFF}".`;
    }
    try {
      await this.#applyEffortChange(rec, parsed.value);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Could not set reasoning effort: ${message}`;
    }
    await this.#sendUpdate(client, sessionId, {
      sessionUpdate: "config_option_update",
      configOptions: buildSessionConfigOptions(
        rec.config,
        resolveSessionMode(getModeState(rec.agent).mode),
      ),
    });
    return `Set reasoning effort to "${parsed.value ?? REASONING_EFFORT_OFF}".`;
  }

  async #commandSetYolo(
    sessionId: string,
    rec: SessionRecord,
    args: string,
  ): Promise<string> {
    const arg = args.trim();
    if (!arg) {
      return `Usage: /yolo <on|off>. Auto-approve is currently ${
        isYoloEnabled(rec.agent) ? "on" : "off"
      }.`;
    }
    const enabled = parseYoloToggle(arg);
    if (enabled === undefined) {
      return `Unknown value "${arg}". Use on or off.`;
    }
    if (isYoloEnabled(rec.agent) === enabled) {
      return `Auto-approve is already ${enabled ? "on" : "off"}.`;
    }
    setYoloEnabled(rec.agent, enabled);
    await patchSessionMeta(this.#acpRoot, sessionId, { yolo: enabled });
    return `Auto-approve tools ${enabled ? "enabled" : "disabled"}.`;
  }

  async #commandCompact(rec: SessionRecord): Promise<string> {
    const conversationManager = getAgentConversationManager(rec.agent);
    if (!conversationManager) {
      return "This session has no conversation manager to compact.";
    }
    const before = rec.agent.messages.length;
    try {
      const reduced = await conversationManager.reduce({
        agent: rec.agent,
        model: rec.agent.model,
      });
      if (!reduced) {
        return "Conversation history is already too short to compact.";
      }
      const after = rec.agent.messages.length;
      await getAgentSessionManager(rec.agent)?.saveSnapshot({
        target: rec.agent,
        isLatest: true,
      });
      return `Compacted conversation history (${before} → ${after} messages).`;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  /** Cancel an in-flight prompt turn. Silent no-op for unknown sessions. */
  async cancel(params: CancelNotification): Promise<void> {
    const rec = this.#sessions.get(params.sessionId);
    if (!rec) {
      return;
    }
    rec.turnAbort?.abort();
    try {
      rec.agent.cancel();
    } catch {
      /* ignore */
    }
  }

  /** Run one prompt turn: stream model output, tool calls, and a stop reason. */
  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const rec = this.#sessions.get(params.sessionId);
    if (!rec) {
      throw RequestError.invalidParams({ sessionId: params.sessionId });
    }
    const client = this.#requireClient();

    // Serialize concurrent prompt turns for the same session.
    const prevExclusive = rec.promptExclusive;
    let releaseExclusive!: () => void;
    const exclusiveGate = new Promise<void>((resolve) => {
      releaseExclusive = resolve;
    });
    rec.promptExclusive = prevExclusive.then(() => exclusiveGate);
    await prevExclusive;

    const turnAbort = new AbortController();
    rec.turnAbort = turnAbort;
    rec.streamedToolCallIds.clear();
    rec.streamingToolInputJson.clear();
    rec.lastStreamToolUseId = null;

    let stopReason: StopReason = "end_turn";

    try {
      const echo = acpPromptEchoText(params.prompt);
      if (echo.length > 0) {
        await this.#sendUpdate(client, params.sessionId, {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: echo },
        });
        await this.#maybeDeriveTitle(client, params.sessionId, echo);
      }

      // Slash commands arrive as prompt text. Control commands run inline
      // (no model turn); `/init` rewrites the prompt and runs normally.
      const command = parseAcpSlashCommand(echo);
      if (command && command.name !== "init") {
        const reply = await this.#runControlCommand(
          client,
          params.sessionId,
          rec,
          command,
        );
        if (reply) {
          await this.#sendUpdate(client, params.sessionId, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: reply },
          });
        }
        return { stopReason: "end_turn" };
      }

      const invokeArgs =
        command?.name === "init"
          ? acpPromptToInvokeArgs([
              {
                type: "text",
                text: command.args
                  ? `${INIT_AGENTS_PROMPT}\n\n${command.args}`
                  : INIT_AGENTS_PROMPT,
              },
            ])
          : acpPromptToInvokeArgs(params.prompt);
      const signals: AbortSignal[] = [turnAbort.signal];
      if (this.#connectionSignal) {
        signals.push(this.#connectionSignal);
      }
      const cancelSignal = AbortSignal.any(signals);

      // A new turn resets todos (BeforeInvocationEvent). Clear any stale plan
      // the client is still showing from the previous turn.
      if (getTodoViewState(rec.agent).total > 0) {
        await this.#sendUpdate(client, params.sessionId, {
          sessionUpdate: "plan",
          entries: [],
        });
      }

      try {
        await runWithAgentMemoryScope(rec.agent, async () => {
          await runWithCwd(rec.cwd, async () => {
            const stream = rec.agent.stream(invokeArgs, { cancelSignal });
            let iter = await stream.next();
            while (!iter.done) {
              const ev = iter.value;
              if (ev.type === "modelStreamUpdateEvent") {
                await this.#dispatchModelStreamUpdate(
                  client,
                  params.sessionId,
                  ev,
                  rec,
                );
              } else if (ev.type === "afterToolCallEvent") {
                const display = takeFileToolDisplay(
                  rec.agent.appState,
                  ev.toolUse.toolUseId,
                );
                const diff = fileToolDiffContent(display);
                const locations = toolCallLocationsFromInput(
                  ev.toolUse.name,
                  ev.toolUse.input,
                );
                // Keep the embedded terminal (retained by the client after
                // release) as the completed content, rather than replacing the
                // live output with a JSON result blob. The structured result
                // still travels to the model via `rawOutput`.
                const terminalId = rec.terminalByToolCall.get(
                  ev.toolUse.toolUseId,
                );
                rec.terminalByToolCall.delete(ev.toolUse.toolUseId);
                const content: Array<ToolCallContent> =
                  terminalId !== undefined
                    ? [{ type: "terminal", terminalId }]
                    : (diff ?? toolResultToAcpContent(ev.result));
                await this.#sendUpdate(client, params.sessionId, {
                  sessionUpdate: "tool_call_update",
                  toolCallId: ev.toolUse.toolUseId,
                  status:
                    ev.result.status === "success" ? "completed" : "failed",
                  rawOutput: ev.result.toJSON() as unknown,
                  content,
                  ...(locations ? { locations } : {}),
                });
                if (
                  ev.toolUse.name === UPDATE_TODOS_TOOL_NAME &&
                  ev.result.status === "success"
                ) {
                  await this.#sendPlanUpdate(client, params.sessionId, rec);
                }
                if (
                  ev.result.status === "success" &&
                  (ev.toolUse.name === ENTER_PLAN_MODE_TOOL ||
                    ev.toolUse.name === EXIT_PLAN_MODE_TOOL)
                ) {
                  await this.#syncCurrentMode(client, params.sessionId, rec);
                }
              } else if (ev.type === "agentResultEvent") {
                stopReason = toAcpStopReason(ev.result.stopReason);
              }
              iter = await stream.next();
            }
          });
        });
      } catch (err) {
        const cancelSignals = [cancelSignal, turnAbort.signal] as const;
        if (isCancellationError(err, cancelSignals)) {
          stopReason = "cancelled";
        } else {
          const message = err instanceof Error ? err.message : String(err);
          await this.#sendUpdate(client, params.sessionId, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: `\n[error] ${message}\n` },
          });
          stopReason = "refusal";
        }
      }

      // If cancellation was requested, report `cancelled` even when the stream
      // happened to finish cleanly right as the signal fired (spec requires the
      // prompt to resolve with the cancelled stop reason, not `end_turn`).
      if (turnAbort.signal.aborted) {
        stopReason = "cancelled";
      }
    } finally {
      rec.turnAbort = null;
      // Apply mode/model changes requested mid-turn before releasing the gate
      // so the next turn sees the settled state.
      await this.#flushPendingSettings(rec);
      releaseExclusive();
      try {
        await saveSessionMessages(
          this.#acpRoot,
          params.sessionId,
          serializeAgentMessages(rec.agent),
        );
      } catch {
        /* ignore */
      }
    }

    if (consumeExitRequest(rec.agent)) {
      await this.#disposeAll();
      setTimeout(() => process.exit(EXIT_REQUESTED_CODE), 25);
    }

    return { stopReason };
  }

  /**
   * Surface the agent's todo list as an ACP `plan` update. Sends the complete
   * list, as the client replaces the plan wholesale on each update. The
   * in-progress entry uses its present-tense `activeForm` for a nicer live view.
   */
  #sendPlanUpdate(
    client: AgentContext,
    sessionId: string,
    rec: SessionRecord,
  ): Promise<void> {
    const { todos } = getTodoViewState(rec.agent);
    return this.#sendUpdate(client, sessionId, {
      sessionUpdate: "plan",
      entries: todos.map((todo) => ({
        content:
          todo.status === "in_progress" && todo.activeForm
            ? todo.activeForm
            : todo.content,
        priority: todo.priority,
        status: todo.status,
      })),
    });
  }

  /**
   * Reflect an agent-driven mode change (e.g. `enter_plan_mode` /
   * `exit_plan_mode`) to the client via `current_mode_update` and persist it.
   */
  async #syncCurrentMode(
    client: AgentContext,
    sessionId: string,
    rec: SessionRecord,
  ): Promise<void> {
    const modeId = resolveSessionMode(getModeState(rec.agent).mode);
    await patchSessionMeta(this.#acpRoot, sessionId, { sessionMode: modeId });
    await this.#sendUpdate(client, sessionId, {
      sessionUpdate: "current_mode_update",
      currentModeId: modeId,
    });
    // Config Options supersede modes; mirror the change for config-aware clients.
    await this.#sendUpdate(client, sessionId, {
      sessionUpdate: "config_option_update",
      configOptions: buildSessionConfigOptions(rec.config, modeId),
    });
  }

  /** Derive + persist a title from the first meaningful prompt echo. */
  async #maybeDeriveTitle(
    client: AgentContext,
    sessionId: string,
    echo: string,
  ): Promise<void> {
    const meta = await readSessionMeta(this.#acpRoot, sessionId);
    const needsTitle =
      meta &&
      (meta.title === undefined ||
        meta.title === null ||
        String(meta.title).trim() === "");
    if (!needsTitle) {
      return;
    }
    const title = deriveSessionTitleFromEcho(echo);
    if (!title) {
      return;
    }
    await patchSessionMeta(this.#acpRoot, sessionId, { title });
    await this.#sendUpdate(client, sessionId, {
      sessionUpdate: "session_info_update",
      title,
      updatedAt: new Date().toISOString(),
    });
  }

  /** Translate a Strands model-stream event into ACP `session/update`s. */
  async #dispatchModelStreamUpdate(
    client: AgentContext,
    sessionId: string,
    ev: ModelStreamUpdateEvent,
    rec: SessionRecord,
  ): Promise<void> {
    const inner = ev.event;
    if (!isModelStreamEvent(inner)) {
      return;
    }
    switch (inner.type) {
      case "modelContentBlockStartEvent": {
        const start = inner.start;
        if (start?.type === "toolUseStart") {
          rec.streamedToolCallIds.add(start.toolUseId);
          rec.lastStreamToolUseId = start.toolUseId;
          rec.streamingToolInputJson.set(start.toolUseId, "");
          await this.#sendUpdate(client, sessionId, {
            sessionUpdate: "tool_call",
            toolCallId: start.toolUseId,
            title: start.name,
            kind: inferToolKind(start.name),
            status: "pending",
            rawInput: {},
          });
        }
        return;
      }
      case "modelContentBlockDeltaEvent": {
        const { delta } = inner;
        if (delta.type === "textDelta" && delta.text) {
          await this.#sendUpdate(client, sessionId, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: delta.text },
          });
          return;
        }
        if (delta.type === "reasoningContentDelta") {
          if (delta.text) {
            await this.#sendUpdate(client, sessionId, {
              sessionUpdate: "agent_thought_chunk",
              content: { type: "text", text: delta.text },
            });
          }
          return;
        }
        if (delta.type === "toolUseInputDelta") {
          const toolUseId = this.#streamToolUseIdForInputDelta(rec);
          if (!toolUseId) {
            return;
          }
          const prev = rec.streamingToolInputJson.get(toolUseId) ?? "";
          const next = prev + delta.input;
          rec.streamingToolInputJson.set(toolUseId, next);
          await this.#sendUpdate(client, sessionId, {
            sessionUpdate: "tool_call_update",
            toolCallId: toolUseId,
            rawInput: parseStreamingToolJson(next),
          });
          return;
        }
        if (delta.type === "citationsDelta") {
          const n = delta.citations?.length ?? 0;
          if (n > 0) {
            await this.#sendUpdate(client, sessionId, {
              sessionUpdate: "agent_thought_chunk",
              content: {
                type: "text",
                text: `[citations: ${n} reference(s)]\n`,
              },
            });
          }
        }
        return;
      }
      case "modelRedactionEvent": {
        const replace =
          inner.outputRedaction?.replaceContent ??
          inner.inputRedaction?.replaceContent;
        if (replace) {
          await this.#sendUpdate(client, sessionId, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: replace },
          });
        }
        return;
      }
      default:
        return;
    }
  }

  #streamToolUseIdForInputDelta(rec: SessionRecord): string | undefined {
    if (
      rec.lastStreamToolUseId &&
      rec.streamedToolCallIds.has(rec.lastStreamToolUseId)
    ) {
      return rec.lastStreamToolUseId;
    }
    const keys = [...rec.streamingToolInputJson.keys()];
    return keys.length === 1 ? keys[0]! : undefined;
  }

  #sendUpdate(
    client: AgentContext,
    sessionId: string,
    update: SessionNotification["update"],
  ): Promise<void> {
    return client.notify(methods.client.session.update, { sessionId, update });
  }

  #requireClient(): AgentContext {
    if (!this.#client) {
      throw RequestError.internalError({
        message: "ACP client context is not available.",
      });
    }
    return this.#client;
  }

  async #bootstrapSession(
    sessionId: string,
    cwd: string,
    userId: string,
    mcpServers: SessionMetaFile["mcpServers"],
    mode: SessionMode,
    preferredModel?: string,
  ): Promise<SessionRecord> {
    const client = this.#requireClient();
    const sessionConfig = createSessionConfig();
    if (
      preferredModel &&
      preferredModel !== currentModelName(sessionConfig) &&
      sessionConfig.llms.some((entry) => entry.name === preferredModel)
    ) {
      sessionConfig.update({
        llms: sessionConfig.llms.map((entry) => ({
          ...entry,
          default: entry.name === preferredModel,
        })),
      });
    }
    const {
      config,
      agent,
      mcp: { manager },
    } = await bootstrap(
      "acp",
      {
        userId,
        sessionId,
        mode,
        createInterventions: () => [
          createAcpToolApprovalIntervention(
            client,
            sessionId,
            () =>
              this.#sessions.get(sessionId)?.streamedToolCallIds ??
              EMPTY_STREAMED_TOOL_CALL_IDS,
          ),
        ],
        acp: { mcpServers: mcpServers ?? [] },
      },
      false,
      sessionConfig,
    );

    this.#registerTextFsBackend(agent, client, sessionId);
    this.#registerTerminalBackend(agent, client, sessionId);

    return {
      cwd,
      agent,
      config: config as SessionConfig,
      mcpDisconnect: () => manager.disconnect().catch(() => undefined),
      turnAbort: null,
      promptExclusive: Promise.resolve(),
      streamedToolCallIds: new Set(),
      streamingToolInputJson: new Map(),
      lastStreamToolUseId: null,
      terminalByToolCall: new Map(),
      pendingModeReapply: false,
      pendingModelRebuild: false,
      pendingPersistModel: null,
      pendingPersistEffort: null,
    };
  }

  /**
   * Route the built-in filesystem tools' text reads/writes through the client's
   * `fs/*` methods when it advertised the capability during initialization.
   */
  #registerTextFsBackend(
    agent: object,
    client: AgentContext,
    sessionId: string,
  ): void {
    const caps = this.#clientFsCaps;
    if (!caps || (!caps.readTextFile && !caps.writeTextFile)) {
      return;
    }
    setTextFsBackend(agent, {
      canRead: caps.readTextFile === true,
      canWrite: caps.writeTextFile === true,
      readTextFile: async (filePath, options) => {
        const response = await client.request(methods.client.fs.readTextFile, {
          sessionId,
          path: filePath,
          ...(options?.line !== undefined ? { line: options.line } : {}),
          ...(options?.limit !== undefined ? { limit: options.limit } : {}),
        });
        return response.content;
      },
      writeTextFile: async (filePath, content) => {
        await client.request(methods.client.fs.writeTextFile, {
          sessionId,
          path: filePath,
          content,
        });
      },
    });
  }

  /**
   * Route the built-in `shell` tool through the client's `terminal/*` methods
   * when it advertised the `terminal` capability during initialization.
   */
  #registerTerminalBackend(
    agent: object,
    client: AgentContext,
    sessionId: string,
  ): void {
    if (!this.#clientTerminalCap) {
      return;
    }
    setTerminalBackend(agent, {
      run: (request) => this.#runClientTerminal(client, sessionId, request),
    });
  }

  async #runClientTerminal(
    client: AgentContext,
    sessionId: string,
    request: TerminalRunRequest,
  ): Promise<TerminalRunResult> {
    const created = await client.request(
      methods.client.terminal.create,
      {
        sessionId,
        command: request.command,
        args: request.args,
        cwd: request.cwd,
        ...(request.outputByteLimit !== undefined
          ? { outputByteLimit: request.outputByteLimit }
          : {}),
      },
      // Cascade `$/cancel_request` if the turn is cancelled before the terminal
      // is created; once created we explicitly kill+release below instead.
      { cancellationSignal: request.cancelSignal },
    );
    const terminalId = created.terminalId;

    try {
      // Embed the live terminal in the tool call so the client streams output.
      // Record it so the completed tool-call update keeps the terminal view
      // (which the client retains after release) instead of a JSON result blob.
      if (request.toolUseId) {
        this.#sessions
          .get(sessionId)
          ?.terminalByToolCall.set(request.toolUseId, terminalId);
        await this.#sendUpdate(client, sessionId, {
          sessionUpdate: "tool_call_update",
          toolCallId: request.toolUseId,
          status: "in_progress",
          content: [{ type: "terminal", terminalId }],
        });
      }

      const { exit, timedOut } = await this.#awaitTerminalExit(
        client,
        sessionId,
        terminalId,
        request,
      );

      const output = await client.request(methods.client.terminal.output, {
        sessionId,
        terminalId,
      });

      return {
        output: output.output,
        truncated: output.truncated,
        exitCode: exit?.exitCode ?? output.exitStatus?.exitCode ?? null,
        signal: exit?.signal ?? output.exitStatus?.signal ?? null,
        timedOut,
      };
    } finally {
      await client
        .request(methods.client.terminal.release, { sessionId, terminalId })
        .catch(() => undefined);
    }
  }

  /**
   * Wait for the command to exit, killing it if the timeout elapses or the turn
   * is cancelled (spec: "Building a Timeout").
   */
  async #awaitTerminalExit(
    client: AgentContext,
    sessionId: string,
    terminalId: string,
    request: TerminalRunRequest,
  ): Promise<{
    exit: { exitCode?: number | null; signal?: string | null } | null;
    timedOut: boolean;
  }> {
    const waitForExit = client.request(methods.client.terminal.waitForExit, {
      sessionId,
      terminalId,
    });
    // Both branches are handled so a late settle never becomes unhandled.
    const exitRace = waitForExit.then(
      (value) => ({ kind: "exit" as const, value }),
      () => ({ kind: "exit" as const, value: null }),
    );

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutRace = new Promise<{ kind: "timeout" }>((resolve) => {
      timer = setTimeout(() => resolve({ kind: "timeout" }), request.timeoutMs);
    });

    const signal = request.cancelSignal;
    let onAbort: (() => void) | undefined;
    const cancelRace = new Promise<{ kind: "cancel" }>((resolve) => {
      if (!signal) {
        return;
      }
      if (signal.aborted) {
        resolve({ kind: "cancel" });
        return;
      }
      onAbort = () => resolve({ kind: "cancel" });
      signal.addEventListener("abort", onAbort, { once: true });
    });

    try {
      const winner = await Promise.race([exitRace, timeoutRace, cancelRace]);
      if (winner.kind === "exit") {
        return { exit: winner.value, timedOut: false };
      }
      await client
        .request(methods.client.terminal.kill, { sessionId, terminalId })
        .catch(() => undefined);
      return { exit: null, timedOut: winner.kind === "timeout" };
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      if (signal && onAbort) {
        signal.removeEventListener("abort", onAbort);
      }
    }
  }

  async #disposeAll(): Promise<void> {
    const records = [...this.#sessions.values()];
    this.#sessions.clear();
    for (const record of records) {
      record.turnAbort?.abort();
      await record.mcpDisconnect();
    }
  }
}

/** Build the ACP agent app and register the handlers implemented so far. */
export function createAcpApp(agent: HoomanAcpAgent): AgentApp {
  return acpAgent({ name: "hooman" })
    .onConnect((connection) => agent.onConnect(connection))
    .onRequest(methods.agent.initialize, (ctx) => agent.initialize(ctx.params))
    .onRequest(methods.agent.session.new, (ctx) => agent.newSession(ctx.params))
    .onRequest(methods.agent.session.load, (ctx) =>
      agent.loadSession(ctx.params, ctx.client),
    )
    .onRequest(methods.agent.session.list, (ctx) =>
      agent.listSessions(ctx.params),
    )
    .onRequest(methods.agent.session.delete, (ctx) =>
      agent.deleteSession(ctx.params),
    )
    .onRequest(methods.agent.session.setMode, (ctx) =>
      agent.setSessionMode(ctx.params),
    )
    .onRequest(methods.agent.session.setConfigOption, (ctx) =>
      agent.setSessionConfigOption(ctx.params),
    )
    .onRequest(methods.agent.session.prompt, (ctx) => agent.prompt(ctx.params))
    .onNotification(methods.agent.session.cancel, (ctx) =>
      agent.cancel(ctx.params),
    );
}

/** Run Hooman as an ACP agent over stdio. */
export async function runAcpStdio(): Promise<void> {
  const identity = await readAgentIdentity();
  const stream = ndJsonStream(
    Writable.toWeb(stdout) as unknown as WritableStream<Uint8Array>,
    Readable.toWeb(stdin) as unknown as ReadableStream<Uint8Array>,
  );
  const connection = createAcpApp(new HoomanAcpAgent(identity)).connect(stream);
  await connection.closed;
}
