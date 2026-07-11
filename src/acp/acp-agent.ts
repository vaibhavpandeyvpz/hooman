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
  type CloseSessionRequest,
  type CloseSessionResponse,
  type DeleteSessionRequest,
  type ForkSessionRequest,
  type ForkSessionResponse,
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
  type ResumeSessionRequest,
  type ResumeSessionResponse,
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
  ModelStreamUpdateEvent,
  type Agent as StrandsAgent,
  type StopReason as StrandsStopReason,
  type Usage,
} from "@strands-agents/sdk";
import { bootstrap } from "../core/index.js";
import { MODE_DEFINITIONS } from "../core/modes/definitions.js";
import {
  DEFAULT_SESSION_MODE,
  isKnownSessionMode,
  type SessionMode,
} from "../core/modes/schema.js";
import { getModeState, setSessionMode } from "../core/state/session-mode.js";
import { isYoloEnabled, setYoloEnabled } from "../core/state/yolo.js";
import { setLlmModality } from "../core/state/llm-modality.js";
import {
  dropTurnBoundariesFrom,
  getTurnBoundary,
  recordTurnBoundary,
} from "../core/state/turn-boundaries.js";
import {
  ChatTurnSteeringController,
  createChatTurnSteeringIntervention,
} from "../core/agent/turn-steering.js";
import {
  getAgentConversationManager,
  getAgentSessionManager,
} from "../core/agent/index.js";
import { readBundledPrompt } from "../core/prompts/bundled.js";
import { modelProviders } from "../core/models/index.js";
import {
  subscribeModelDownloadProgress,
  type ModelDownloadProgress,
} from "../core/utils/download-progress.js";
import {
  subscribeModelRetryProgress,
  type ModelRetryProgress,
} from "../core/agent/retry-progress.js";
import { toAdditiveUsage } from "../core/utils/usage.js";
import {
  computeUsageCostUsd,
  configuredLlmContext,
  contextTokensFromUsage,
  resolveLlmMetadata,
  type ResolvedLlmMetadata,
} from "../core/utils/metadata.js";
import {
  buildSessionConfigOptions,
  currentModelName,
  CONFIG_ID_EFFORT,
  CONFIG_ID_MODE,
  CONFIG_ID_MODEL,
  CONFIG_ID_YOLO,
} from "./session-config.js";
import {
  activeProviderName,
  parseReasoningEffortArg,
  withReasoningEffort,
} from "../core/utils/reasoning-effort.js";
import {
  ACP_SLASH_COMMANDS,
  parseAcpSlashCommand,
  type ParsedSlashCommand,
} from "./commands.js";
import { SWITCH_MODE_TOOL } from "../core/state/tool-approvals.js";
import { runWithCwd } from "../core/utils/cwd-context.js";
import { runWithAgentMemoryScope } from "../core/memory/index.js";
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
import { setAskUserBackend } from "../core/tools/ask-user.js";
import { setBrowserPreviewBackend } from "../core/utils/browser.js";
import { setTextFsBackend } from "../core/tools/filesystem.js";
import {
  setTerminalBackend,
  type TerminalRunRequest,
  type TerminalRunResult,
  type TerminalOutputSnapshot,
  type TerminalSpawnResult,
  clearShellJobManager,
  getShellJobManager,
  type ShellJobEvent,
} from "../core/shell/index.js";
import { createAcpToolApprovalIntervention } from "./approvals.js";
import { createAcpAskUserBackend } from "./questions.js";
import { createAcpBrowserPreviewBackend } from "./browser.js";
import { extractAcpClientUserId } from "./meta/user-id.js";
import { isAcpVscodeHost } from "./meta/vscode.js";
import { deriveSessionTitleFromEcho } from "./sessions/title.js";
import { acpPromptEchoText, acpPromptToInvokeArgs } from "./prompt-invoke.js";
import { normalizeAcpSessionMcpServers } from "./mcp-servers.js";
import { replayConversationHistory } from "./sessions/replay.js";
import {
  compactSessionIndex,
  deleteSessionEntry,
  migrateLegacySessionStore,
  patchSessionEntry,
  readSessionEntry,
  readSessionIndex,
  touchSessionEntry,
  writeSessionEntry,
  type SessionIndexEntry,
} from "./sessions/store.js";
import { FlatFileStorage } from "../core/sessions/flat-file-storage.js";
import { sessionsPath } from "../core/utils/paths.js";

/** Max sessions returned per `session/list` page. */
const LIST_PAGE_SIZE = 40;

/** Fallback when a session record is missing (never mutate). */
const EMPTY_STREAMED_TOOL_CALL_IDS: ReadonlySet<string> = new Set<string>();

/** Prompt injected by the `/init` slash command (generates AGENTS.md). */
const INIT_AGENTS_PROMPT = readBundledPrompt("static", "init.md");

/** Name + version reported to the client in `agentInfo`. */
type AgentIdentity = { name: string; version: string };

/**
 * Params/response for the custom `_hoomanjs/rewind_session` method (turn
 * revert). Not part of the ACP spec — registered as a custom request
 * via `AgentApp.onRequest(method: string, parser, handler)`. `messageId` is
 * the agent-generated ACP id (see the MessageId RFD) of the turn's user
 * message, captured by the client from that message's `user_message_chunk`
 * echo — never minted by the client itself.
 */
export interface RewindSessionRequest {
  sessionId: string;
  messageId: string;
}

export interface RewindSessionResponse {
  /** False when `messageId` has no recorded boundary (e.g. session reloaded since that turn ran). */
  reverted: boolean;
}

/** Params/response for the custom `_hoomanjs/stop_shell_job` method. */
export interface StopShellJobRequest {
  sessionId: string;
  jobId: string;
}

export interface StopShellJobResponse {
  stopped: boolean;
}

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
  /**
   * Buffers follow-up prompts sent while a turn is active so the client can
   * "steer" the running turn (`_meta["hoomanjs/steer"]` on `session/prompt`)
   * instead of waiting for a brand new turn.
   */
  steering: ChatTurnSteeringController;
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
  /**
   * Background shell jobs hosted via the client's `terminal/*` API, keyed by
   * `job_id`. Terminals are not released until the job stops or the session ends.
   */
  shellJobs: Map<string, { terminalId: string; toolCallId?: string }>;
  /** Unsubscribe from ShellJobManager events for this session. */
  shellJobUnsub: (() => void) | null;
  /** `messageId` shared by all `agent_message_chunk`/`agent_thought_chunk` updates for the in-flight assistant message. */
  currentAssistantMessageId: string | null;
  /** Re-apply the mode tool surface at the next turn boundary (deferred mid-turn). */
  pendingModeReapply: boolean;
  /** Rebuild the model at the next turn boundary (deferred mid-turn). */
  pendingModelRebuild: boolean;
  /** Persist this default model to shared config after a deferred rebuild. */
  pendingPersistModel: string | null;
  /** Persist this provider's effort to shared config after a deferred rebuild. */
  pendingPersistEffort: { provider: string; effort: string | undefined } | null;
  /**
   * Current turn's token usage (additive shape), mirroring the CLI TUI's
   * `StatusBar` meter: input/cached-input are the latest request's values,
   * output tokens accumulate across every request in the turn. Reset at the
   * start of each `prompt()` call. Distinct from the context-window
   * utilization sent as `usage_update.used`.
   */
  lastTurnUsage: Usage;
  /**
   * Billing metadata for the active model (config `metadata` merged with the
   * models.dev catalog), re-resolved on model rebuilds. `null` when nothing
   * could be resolved — context size and cost are then not reported.
   */
  metadata: ResolvedLlmMetadata | null;
  /** Cumulative session cost in USD, accumulated per request at that request's model rates. */
  cumulativeCostUsd: number;
  /**
   * Set once any request with token usage ran without resolved pricing; the
   * session total would be incomplete, so cost reporting stops for good.
   */
  costUnpriced: boolean;
  /** Context tokens of the latest request (additive prompt total), for `usage_update.used`. */
  lastContextTokens: number | undefined;
  /** Timestamp of the first output-text delta of the in-flight model request, for output tokens/sec. */
  genStartedAt: number | null;
  /** Output tokens/sec over the latest request's generation window (first text delta through its metadata event). */
  lastTokensPerSecond: number | undefined;
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

/** Zeroed `Usage` for a fresh session's per-turn token meter. */
function createEmptyUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

/**
 * Build the per-turn token meter from a single request's usage, mirroring the
 * CLI TUI (`src/chat/app.tsx`): input/cached-input reflect just the latest
 * request (each request resends the full context, so those aren't additive
 * — the context gauge already reflects overall window consumption), while
 * output tokens accumulate across every model request in the turn (`prev`),
 * since each request's thinking/tool-call/final-text generation produces new,
 * non-overlapping tokens. `source` must already be in the additive shape (see
 * `toAdditiveUsage`), where cache reads are not part of `inputTokens`.
 */
function lastTurnUsage(prev: Usage, source: Usage): Usage {
  const inputTokens = source.inputTokens ?? 0;
  const outputTokens = (prev.outputTokens ?? 0) + (source.outputTokens ?? 0);
  const cacheRead = source.cacheReadInputTokens ?? 0;
  const cacheWrite = source.cacheWriteInputTokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens + cacheRead + cacheWrite,
    ...(source.cacheReadInputTokens !== undefined && {
      cacheReadInputTokens: cacheRead,
    }),
    ...(source.cacheWriteInputTokens !== undefined && {
      cacheWriteInputTokens: cacheWrite,
    }),
  };
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
    case "interrupt":
      return "cancelled";
    case "maxTokens":
    case "modelContextWindowExceeded":
    case "limitOutputTokens":
    case "limitTotalTokens":
      return "max_tokens";
    case "limitTurns":
      return "max_turn_requests";
    case "contentFiltered":
    case "guardrailIntervened":
      return "refusal";
    case "endTurn":
    case "toolUse":
    case "stopSequence":
    case "pauseTurn":
    default:
      return "end_turn";
  }
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
  /** Strands snapshot storage root (`<project>/sessions`); message source of truth. */
  readonly #snapshotsRoot = sessionsPath();
  /** Resolves once the legacy store migration + index compaction have run. */
  readonly #storeReady: Promise<void>;
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
    this.#storeReady = migrateLegacySessionStore(
      this.#acpRoot,
      this.#snapshotsRoot,
    )
      .then(() => compactSessionIndex(this.#acpRoot))
      .catch(() => undefined);
    // Model weights download progress (llama.cpp GGUF fetched on first use,
    // which happens lazily inside a prompt turn's model init): forward to the
    // client as a custom `_hoomanjs/model_download` notification, attributed
    // to whichever session(s) have an active turn. Clients that don't know
    // the method ignore it per JSON-RPC; the VS Code extension renders it as
    // a progress strip. Lives for the process, like the agent itself.
    subscribeModelDownloadProgress((progress) => {
      const client = this.#client;
      if (!client) {
        return;
      }
      for (const [sessionId, rec] of this.#sessions) {
        if (!this.#isTurnActive(rec)) {
          continue;
        }
        void client
          .notify<ModelDownloadProgress & { sessionId: string }>(
            "_hoomanjs/model_download",
            { sessionId, ...progress },
          )
          .catch(() => undefined);
      }
    });
    subscribeModelRetryProgress((progress) => {
      const client = this.#client;
      if (!client) {
        return;
      }
      if (progress.sessionId) {
        const rec = this.#sessions.get(progress.sessionId);
        if (!rec || !this.#isTurnActive(rec)) {
          return;
        }
        void client
          .notify<ModelRetryProgress & { sessionId: string }>(
            "_hoomanjs/model_retry",
            { sessionId: progress.sessionId, ...progress },
          )
          .catch(() => undefined);
        return;
      }
      for (const [sessionId, rec] of this.#sessions) {
        if (!this.#isTurnActive(rec)) {
          continue;
        }
        void client
          .notify<ModelRetryProgress & { sessionId: string }>(
            "_hoomanjs/model_retry",
            { sessionId, ...progress },
          )
          .catch(() => undefined);
      }
    });
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
          embeddedContext: true,
        },
        mcpCapabilities: {
          http: true,
          sse: true,
        },
        sessionCapabilities: {
          list: {},
          delete: {},
          fork: {},
          resume: {},
          close: {},
        },
      },
    };
  }

  async listSessions(
    params: ListSessionsRequest,
  ): Promise<ListSessionsResponse> {
    await this.#storeReady;
    const entries = await readSessionIndex(this.#acpRoot);
    const sessions: SessionInfo[] = [];
    for (const entry of entries.values()) {
      if (!params.cwd || entry.cwd === params.cwd) {
        sessions.push({
          sessionId: entry.sessionId,
          cwd: entry.cwd,
          title: entry.title ?? null,
          updatedAt: entry.updatedAt,
        });
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
    await this.#storeReady;
    const record = this.#sessions.get(params.sessionId);
    if (record) {
      this.#sessions.delete(params.sessionId);
      record.turnAbort?.abort();
      await this.#teardownShellJobs(params.sessionId, record);
      await record.mcpDisconnect();
    }
    await deleteSessionEntry(this.#acpRoot, params.sessionId);
    // Also drop the Strands snapshot (the conversation history itself).
    await new FlatFileStorage(this.#snapshotsRoot).deleteSession({
      sessionId: params.sessionId,
    });
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    await this.#storeReady;
    assertAbsolutePath(params.cwd, "cwd");
    const sessionId = crypto.randomUUID();
    const clientUserId = extractAcpClientUserId(params._meta) ?? null;
    const mcpServers = normalizeAcpSessionMcpServers(params.mcpServers);
    const vscode = isAcpVscodeHost();

    const mode = DEFAULT_SESSION_MODE;
    const now = new Date().toISOString();
    const entry: SessionIndexEntry = {
      sessionId,
      cwd: params.cwd,
      createdAt: now,
      updatedAt: now,
      title: null,
      userId: clientUserId,
      mcpServers,
      ...(vscode ? { vscode } : {}),
      sessionMode: mode,
    };
    await writeSessionEntry(this.#acpRoot, entry);

    const record = await this.#bootstrapSession(
      sessionId,
      params.cwd,
      clientUserId ?? sessionId,
      mcpServers,
      mode,
      undefined,
      vscode,
    );
    this.#sessions.set(sessionId, record);
    this.#subscribeShellJobs(record.agent, this.#requireClient(), sessionId);
    await this.#advertiseCommands(this.#requireClient(), sessionId);

    return {
      sessionId,
      modes: buildSessionModeState(mode),
      configOptions: buildSessionConfigOptions(
        record.config,
        mode,
        isYoloEnabled(record.agent),
      ),
    };
  }

  async forkSession(
    params: ForkSessionRequest,
    _client: AgentContext,
  ): Promise<ForkSessionResponse> {
    await this.#storeReady;
    assertAbsolutePath(params.cwd, "cwd");
    const sourceEntry = await readSessionEntry(this.#acpRoot, params.sessionId);
    if (!sourceEntry) {
      throw RequestError.resourceNotFound(`session:${params.sessionId}`);
    }
    const sourceRecord = this.#sessions.get(params.sessionId);
    if (sourceRecord && this.#isTurnActive(sourceRecord)) {
      throw RequestError.invalidParams({
        sessionId: params.sessionId,
        message: "Cannot fork a session while a turn is still running.",
      });
    }
    if (sourceRecord) {
      await getAgentSessionManager(sourceRecord.agent)?.saveSnapshot({
        target: sourceRecord.agent,
        isLatest: true,
      });
    }

    const sessionId = crypto.randomUUID();
    const clientUserId = extractAcpClientUserId(params._meta);
    const userId =
      clientUserId !== undefined ? clientUserId : (sourceEntry.userId ?? null);
    const mcpServers =
      params.mcpServers && params.mcpServers.length > 0
        ? normalizeAcpSessionMcpServers(params.mcpServers)
        : (sourceEntry.mcpServers ?? []);
    const vscode = isAcpVscodeHost();
    const mode = resolveSessionMode(sourceEntry.sessionMode);
    const now = new Date().toISOString();
    const title = sourceEntry.title
      ? `${sourceEntry.title} (fork)`
      : "Fork Chat";

    const cloned = await new FlatFileStorage(
      this.#snapshotsRoot,
    ).cloneLatestSnapshot({
      sourceSessionId: params.sessionId,
      targetSessionId: sessionId,
      sourceTitle: title,
    });
    if (!cloned) {
      throw RequestError.internalError({
        message: "Could not clone the source session snapshot.",
      });
    }

    const entry: SessionIndexEntry = {
      sessionId,
      cwd: params.cwd,
      createdAt: now,
      updatedAt: now,
      title,
      userId,
      mcpServers,
      ...(vscode ? { vscode } : {}),
      yolo: sourceEntry.yolo,
      sessionMode: mode,
      model: sourceEntry.model,
    };
    await writeSessionEntry(this.#acpRoot, entry);

    const forkConfig = createSessionConfig();
    if (
      sourceEntry.model &&
      sourceEntry.model !== currentModelName(forkConfig) &&
      forkConfig.llms.some((candidate) => candidate.name === sourceEntry.model)
    ) {
      forkConfig.update({
        llms: forkConfig.llms.map((candidate) => ({
          ...candidate,
          default: candidate.name === sourceEntry.model,
        })),
      });
    }

    return {
      sessionId,
      modes: buildSessionModeState(mode),
      configOptions: buildSessionConfigOptions(
        forkConfig,
        mode,
        sourceEntry.yolo === true,
      ),
    };
  }

  /**
   * Turn revert (custom `_hoomanjs/rewind_session` method, not part
   * of the ACP spec): splice `agent.messages` back to the message index
   * bookmarked for `messageId` (see {@link recordTurnBoundary}), dropping
   * that turn and every turn after it, then persist the trimmed history.
   *
   * Returns `reverted: false` instead of erroring when `messageId` has no
   * recorded boundary — e.g. the session was reloaded since that turn ran,
   * so its in-memory bookmark (and the client's matching file-edit
   * baselines) no longer exist.
   */
  async rewindSession(
    params: RewindSessionRequest,
  ): Promise<RewindSessionResponse> {
    const rec = this.#sessions.get(params.sessionId);
    if (!rec) {
      throw RequestError.invalidParams({ sessionId: params.sessionId });
    }
    if (this.#isTurnActive(rec)) {
      throw RequestError.invalidParams({
        sessionId: params.sessionId,
        message: "Cannot rewind a session while a turn is still running.",
      });
    }
    const boundary = getTurnBoundary(rec.agent, params.messageId);
    if (boundary === undefined) {
      return { reverted: false };
    }
    rec.agent.messages.length = boundary;
    dropTurnBoundariesFrom(rec.agent, params.messageId);
    await getAgentSessionManager(rec.agent)?.saveSnapshot({
      target: rec.agent,
      isLatest: true,
    });
    return { reverted: true };
  }

  /**
   * Custom `_hoomanjs/stop_shell_job`: stop a background shell job by id.
   * Routes through {@link ShellJobManager.stop}, which kills the host terminal
   * (process group) and emits the completion notification the UI listens for.
   */
  async stopShellJob(
    params: StopShellJobRequest,
  ): Promise<StopShellJobResponse> {
    const rec = this.#sessions.get(params.sessionId);
    if (!rec) {
      throw RequestError.invalidParams({ sessionId: params.sessionId });
    }
    const manager = getShellJobManager(rec.agent);
    const existing = manager.get(params.jobId);
    if (!existing) {
      return { stopped: false };
    }
    await manager.stop(params.jobId);
    return { stopped: true };
  }

  async loadSession(
    params: LoadSessionRequest,
    client: AgentContext,
  ): Promise<LoadSessionResponse> {
    const { record, mode } = await this.#reactivateSession(
      {
        sessionId: params.sessionId,
        cwd: params.cwd,
        mcpServers: params.mcpServers,
        meta: params._meta,
      },
      client,
      { replayHistory: true },
    );
    return {
      modes: buildSessionModeState(mode),
      configOptions: buildSessionConfigOptions(
        record.config,
        mode,
        isYoloEnabled(record.agent),
      ),
    };
  }

  /**
   * Handle `session/resume`: reactivate a persisted session's in-memory state
   * (including its conversation history, so the turn continues correctly)
   * without replaying that history to the client — the spec reserves the full
   * transcript replay for `session/load`.
   */
  async resumeSession(
    params: ResumeSessionRequest,
    client: AgentContext,
  ): Promise<ResumeSessionResponse> {
    const { record, mode } = await this.#reactivateSession(
      {
        sessionId: params.sessionId,
        cwd: params.cwd,
        mcpServers: params.mcpServers ?? [],
        meta: params._meta,
      },
      client,
      { replayHistory: false },
    );
    return {
      modes: buildSessionModeState(mode),
      configOptions: buildSessionConfigOptions(
        record.config,
        mode,
        isYoloEnabled(record.agent),
      ),
    };
  }

  /**
   * Handle `session/close`: cancel any in-flight turn and free the in-memory
   * session state, without deleting the persisted session from disk (unlike
   * `session/delete`).
   */
  async closeSession(
    params: CloseSessionRequest,
  ): Promise<CloseSessionResponse> {
    const record = this.#sessions.get(params.sessionId);
    if (record) {
      this.#sessions.delete(params.sessionId);
      record.turnAbort?.abort();
      await this.#teardownShellJobs(params.sessionId, record);
      await record.mcpDisconnect();
    }
    return {};
  }

  /** Shared setup for `session/load` and `session/resume`. */
  async #reactivateSession(
    params: {
      sessionId: string;
      cwd: string;
      mcpServers: NewSessionRequest["mcpServers"];
      meta: LoadSessionRequest["_meta"];
    },
    client: AgentContext,
    options: { replayHistory: boolean },
  ): Promise<{ record: SessionRecord; mode: SessionMode }> {
    if (this.#sessions.has(params.sessionId)) {
      throw RequestError.invalidParams({
        sessionId: params.sessionId,
        message: "Session is already active in this agent process.",
      });
    }
    await this.#storeReady;
    const existing = await readSessionEntry(this.#acpRoot, params.sessionId);
    if (!existing) {
      throw RequestError.resourceNotFound(`session:${params.sessionId}`);
    }
    assertAbsolutePath(params.cwd, "cwd");

    const fromRequest = extractAcpClientUserId(params.meta);
    const clientUserId =
      fromRequest !== undefined ? fromRequest : (existing.userId ?? null);
    const mcpServers =
      params.mcpServers.length > 0
        ? normalizeAcpSessionMcpServers(params.mcpServers)
        : (existing.mcpServers ?? []);
    const vscode = isAcpVscodeHost();
    const mode = resolveSessionMode(existing.sessionMode);

    // Bootstrapping restores the Strands snapshot (messages + appState) during
    // `agent.initialize()` — the snapshot is the conversation source of truth.
    const record = await this.#bootstrapSession(
      params.sessionId,
      params.cwd,
      clientUserId ?? params.sessionId,
      mcpServers,
      mode,
      existing.model,
      vscode,
    );

    // The snapshot restore replaces appState wholesale, so re-apply the
    // connection-scoped values that must win over persisted state: the
    // client's user id, and the index-persisted yolo/mode settings.
    record.agent.appState.set("userId", clientUserId ?? params.sessionId);
    setYoloEnabled(record.agent, existing.yolo === true);
    if (resolveSessionMode(getModeState(record.agent).mode) !== mode) {
      setSessionMode(record.agent, mode);
    }

    if (options.replayHistory) {
      await replayConversationHistory(
        client,
        params.sessionId,
        record.agent.messages,
      );
    }

    this.#sessions.set(params.sessionId, record);
    this.#subscribeShellJobs(record.agent, client, params.sessionId);

    await patchSessionEntry(this.#acpRoot, params.sessionId, {
      cwd: params.cwd,
      ...(fromRequest !== undefined ? { userId: fromRequest || null } : {}),
      mcpServers,
      ...(vscode ? { vscode } : {}),
      sessionMode: mode,
    });

    await this.#advertiseCommands(client, params.sessionId);
    // Surface any restored plan so a resumed session shows its todo list.
    if (getTodoViewState(record.agent).total > 0) {
      await this.#sendPlanUpdate(client, params.sessionId, record);
    }

    return { record, mode };
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
    client: AgentContext,
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
      // Keep the (superseding) config-options `mode` value in sync too, since
      // Clients may read either surface (see Session Config Options spec).
      await this.#syncCurrentMode(client, params.sessionId, rec);
    }
    return {};
  }

  /**
   * Handle `session/set_config_option`: apply a model or mode selection and
   * return the complete, up-to-date configuration state (as the spec requires).
   */
  async setSessionConfigOption(
    params: SetSessionConfigOptionRequest,
    client: AgentContext,
  ): Promise<SetSessionConfigOptionResponse> {
    const rec = this.#sessions.get(params.sessionId);
    if (!rec) {
      throw RequestError.invalidParams({ sessionId: params.sessionId });
    }
    // Yolo is a boolean toggle (auto-approve all tool calls), so it carries a
    // boolean value rather than a string one; handle it before the string
    // guard below that the select-style options rely on.
    if (params.configId === CONFIG_ID_YOLO) {
      if (typeof params.value !== "boolean") {
        throw RequestError.invalidParams({
          configId: params.configId,
          message: `Config option "${params.configId}" expects a boolean value`,
        });
      }
      const enabled = params.value;
      if (isYoloEnabled(rec.agent) !== enabled) {
        setYoloEnabled(rec.agent, enabled);
        await patchSessionEntry(this.#acpRoot, params.sessionId, {
          yolo: enabled,
        });
      }
      return {
        configOptions: buildSessionConfigOptions(
          rec.config,
          resolveSessionMode(getModeState(rec.agent).mode),
          isYoloEnabled(rec.agent),
        ),
      };
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
        // Keep the legacy `modes` surface in sync too (see Session Config
        // Options spec: "Agents SHOULD keep both in sync").
        await this.#syncCurrentMode(client, params.sessionId, rec);
      }
    } else if (params.configId === CONFIG_ID_MODEL) {
      await this.#applyModelChange(rec, value);
      await patchSessionEntry(this.#acpRoot, params.sessionId, {
        model: value,
      });
      // The conversation (and thus the context tokens in use) carries over to
      // the new model, so rescale the client's context gauge against the new
      // window immediately instead of leaving the old one up until the next
      // turn ends. Skipped mid-turn: the rebuild (and metadata re-resolution)
      // is deferred to the turn boundary, and the running turn's own
      // `usage_update` is still correctly priced against the old model.
      if (!this.#isTurnActive(rec)) {
        await this.#sendUsageUpdate(
          this.#requireClient(),
          params.sessionId,
          rec,
          undefined,
        );
      }
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
        isYoloEnabled(rec.agent),
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
      rec.metadata = await resolveLlmMetadata(
        resolved.metadata,
        resolved.llmOptions.model,
        resolved.provider,
        configuredLlmContext(resolved),
      ).catch(() => null);
      setLlmModality(rec.agent, rec.metadata?.modality);
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
  async #flushPendingSettings(
    rec: SessionRecord,
    client: AgentContext,
    sessionId: string,
  ): Promise<void> {
    if (rec.pendingModeReapply) {
      rec.pendingModeReapply = false;
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
        // The rebuild re-resolved metadata; rescale the client's context gauge
        // against the new model's window (the turn's earlier `usage_update`
        // carried the previous model's size). Best-effort: the turn result
        // must not fail over a lost notification.
        await this.#sendUsageUpdate(client, sessionId, rec, undefined).catch(
          () => undefined,
        );
      }
    }
  }

  /**
   * Execute an inline (non-model) slash command and return the text reply to
   * stream back as an `agent_message_chunk`. `/init` is handled by the caller.
   */
  #runControlCommand(
    rec: SessionRecord,
    command: ParsedSlashCommand,
  ): Promise<string> {
    switch (command.name) {
      case "compact":
        return this.#commandCompact(rec);
      default:
        return Promise.resolve(`Unknown command "/${command.name}".`);
    }
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

  /**
   * Queue guidance for the currently active turn via {@link ChatTurnSteeringController}
   * rather than starting a new turn. Echoes the steered text back to the
   * client tagged with `_meta["hoomanjs/steered"]` so it can be shown inline
   * in the transcript. Errors (no active turn) surface as a normal RPC error.
   */
  async #steerActiveTurn(
    client: AgentContext,
    rec: SessionRecord,
    params: PromptRequest,
  ): Promise<PromptResponse> {
    if (!this.#isTurnActive(rec)) {
      throw RequestError.invalidParams({
        message: "No active turn to steer.",
      });
    }
    const text = acpPromptEchoText(params.prompt);
    rec.steering.queue([{ text, attachments: [] }]);
    await this.#sendUpdate(client, params.sessionId, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text },
      messageId: crypto.randomUUID(),
      _meta: { "hoomanjs/steered": true },
    });
    return { stopReason: "end_turn" };
  }

  /** Run one prompt turn: stream model output, tool calls, and a stop reason. */
  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const rec = this.#sessions.get(params.sessionId);
    if (!rec) {
      throw RequestError.invalidParams({ sessionId: params.sessionId });
    }
    const client = this.#requireClient();

    // A client-side "steer" request injects guidance into the *currently
    // running* turn (via the steering intervention) instead of queuing a
    // brand new one. See `_meta["hoomanjs/steer"]` extensibility contract.
    if (params._meta?.["hoomanjs/steer"] === true) {
      return this.#steerActiveTurn(client, rec, params);
    }

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
    rec.currentAssistantMessageId = null;
    rec.lastTurnUsage = createEmptyUsage();

    let stopReason: StopReason = "end_turn";

    try {
      const echo = acpPromptEchoText(params.prompt);
      let turnMessageId: string | undefined;
      if (echo.length > 0) {
        turnMessageId = crypto.randomUUID();
        await this.#sendUpdate(client, params.sessionId, {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: echo },
          messageId: turnMessageId,
        });
        await this.#maybeDeriveTitle(client, params.sessionId, echo);
      }

      // Slash commands arrive as prompt text. Control commands run inline
      // (no model turn); `/init` rewrites the prompt and runs normally.
      const command = parseAcpSlashCommand(echo);
      if (command && command.name !== "init") {
        const reply = await this.#runControlCommand(rec, command);
        if (reply) {
          await this.#sendUpdate(client, params.sessionId, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: reply },
            messageId: crypto.randomUUID(),
          });
        }
        return { stopReason: "end_turn" };
      }

      const invokeArgs =
        command?.name === "init"
          ? acpPromptToInvokeArgs(
              [
                {
                  type: "text",
                  text: command.args
                    ? `${INIT_AGENTS_PROMPT}\n\n${command.args}`
                    : INIT_AGENTS_PROMPT,
                },
              ],
              rec.metadata,
            )
          : acpPromptToInvokeArgs(params.prompt, rec.metadata);

      // The `messageId` we just generated for this turn's user_message_chunk
      // echo (see the ACP MessageId RFD) doubles as a durable handle for
      // Turn revert: bookmark where this turn's messages start,
      // before `agent.stream(...)` appends them, so a later `rewindSession`
      // can splice history back to exactly this point.
      if (turnMessageId) {
        recordTurnBoundary(rec.agent, turnMessageId, rec.agent.messages.length);
      }

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
                // Keep terminalByToolCall for background jobs so live polling
                // can continue; only drop the mapping for foreground shells.
                const bgJob = extractBackgroundShellFromResult(ev.result);
                if (!bgJob) {
                  rec.terminalByToolCall.delete(ev.toolUse.toolUseId);
                } else if (terminalId) {
                  rec.shellJobs.set(bgJob.jobId, {
                    terminalId,
                    toolCallId: ev.toolUse.toolUseId,
                  });
                }
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
                  ...(bgJob
                    ? {
                        _meta: {
                          "hoomanjs/shell_job": {
                            event: "started",
                            job_id: bgJob.jobId,
                            description: bgJob.description,
                            status: bgJob.jobStatus ?? "running",
                            terminal_id: terminalId,
                            tool_call_id: ev.toolUse.toolUseId,
                          },
                        },
                      }
                    : {}),
                });
                if (
                  ev.toolUse.name === UPDATE_TODOS_TOOL_NAME &&
                  ev.result.status === "success"
                ) {
                  await this.#sendPlanUpdate(client, params.sessionId, rec);
                }
                if (
                  ev.result.status === "success" &&
                  ev.toolUse.name === SWITCH_MODE_TOOL
                ) {
                  await this.#syncCurrentMode(client, params.sessionId, rec);
                }
              } else if (ev.type === "agentResultEvent") {
                stopReason = toAcpStopReason(ev.result.stopReason);
                await this.#sendUsageUpdate(
                  client,
                  params.sessionId,
                  rec,
                  ev.result.contextSize,
                );
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
            messageId: this.#assistantMessageId(rec),
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
      await this.#flushPendingSettings(rec, client, params.sessionId);
      releaseExclusive();
      // Conversation history is persisted by the Strands session manager
      // (snapshot save on AfterInvocation, which fires even on error/cancel);
      // only the index's `updatedAt` needs bumping for `session/list` order.
      try {
        await touchSessionEntry(this.#acpRoot, params.sessionId);
      } catch {
        /* ignore */
      }
    }

    return { stopReason };
  }

  /**
   * Emit a `usage_update` at the end of a turn:
   * - `used`: context tokens of the latest request (additive prompt total,
   *   so cache reads/writes count regardless of provider reporting style).
   * - `size`: the context window resolved from the model's `metadata` config /
   *   the models.dev catalog; `0` ("unknown") when unresolved, in which case
   *   clients should not render a used/size percentage.
   * - `cost`: cumulative session USD, only while every priced request had
   *   resolved rates — otherwise omitted rather than reporting a lowball.
   * - `_meta["hoomanjs/tokens"]`: this turn's token totals — input/cached-
   *   input from the latest request, output summed across the turn
   *   (mirroring the CLI TUI's per-turn `in`/`cin`/`out` meter).
   */
  #sendUsageUpdate(
    client: AgentContext,
    sessionId: string,
    rec: SessionRecord,
    used: number | undefined,
  ): Promise<void> {
    const contextUsed = rec.lastContextTokens ?? used;
    if (contextUsed === undefined) {
      return Promise.resolve();
    }
    const tokens = rec.lastTurnUsage;
    const includeCost = rec.metadata?.costs !== undefined && !rec.costUnpriced;
    return this.#sendUpdate(client, sessionId, {
      sessionUpdate: "usage_update",
      used: contextUsed,
      size: rec.metadata?.context ?? 0,
      ...(includeCost && {
        cost: { amount: rec.cumulativeCostUsd, currency: "USD" },
      }),
      _meta: {
        "hoomanjs/tokens": {
          input: tokens.inputTokens,
          output: tokens.outputTokens,
          ...(tokens.cacheReadInputTokens !== undefined && {
            cacheRead: tokens.cacheReadInputTokens,
          }),
          ...(tokens.cacheWriteInputTokens !== undefined && {
            cacheWrite: tokens.cacheWriteInputTokens,
          }),
          ...(rec.lastTokensPerSecond !== undefined && {
            tokensPerSecond: rec.lastTokensPerSecond,
          }),
        },
      },
    });
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
   * Reflect an agent-driven mode change (`switch_mode`) to the client via
   * `current_mode_update` and persist it.
   */
  async #syncCurrentMode(
    client: AgentContext,
    sessionId: string,
    rec: SessionRecord,
  ): Promise<void> {
    const modeId = resolveSessionMode(getModeState(rec.agent).mode);
    await patchSessionEntry(this.#acpRoot, sessionId, { sessionMode: modeId });
    await this.#sendUpdate(client, sessionId, {
      sessionUpdate: "current_mode_update",
      currentModeId: modeId,
    });
    // Config Options supersede modes; mirror the change for config-aware clients.
    await this.#sendUpdate(client, sessionId, {
      sessionUpdate: "config_option_update",
      configOptions: buildSessionConfigOptions(
        rec.config,
        modeId,
        isYoloEnabled(rec.agent),
      ),
    });
  }

  /**
   * Derive + persist an instant placeholder title from the first meaningful
   * prompt echo. The session-title plugin upgrades it with an AI-generated
   * summary once the turn runs (see `onSessionTitle` in the bootstrap meta).
   */
  async #maybeDeriveTitle(
    client: AgentContext,
    sessionId: string,
    echo: string,
  ): Promise<void> {
    const entry = await readSessionEntry(this.#acpRoot, sessionId);
    const needsTitle =
      entry &&
      (entry.title === undefined ||
        entry.title === null ||
        String(entry.title).trim() === "");
    if (!needsTitle) {
      return;
    }
    const title = deriveSessionTitleFromEcho(echo);
    if (!title) {
      return;
    }
    await patchSessionEntry(this.#acpRoot, sessionId, { title });
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
      case "modelMessageStartEvent": {
        // A new assistant message starts a fresh `messageId` shared by all of
        // its `agent_message_chunk`/`agent_thought_chunk` updates.
        rec.currentAssistantMessageId = crypto.randomUUID();
        return;
      }
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
          if (rec.genStartedAt === null) {
            rec.genStartedAt = Date.now();
          }
          await this.#sendUpdate(client, sessionId, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: delta.text },
            messageId: this.#assistantMessageId(rec),
          });
          return;
        }
        if (delta.type === "reasoningContentDelta") {
          if (delta.text) {
            await this.#sendUpdate(client, sessionId, {
              sessionUpdate: "agent_thought_chunk",
              content: { type: "text", text: delta.text },
              messageId: this.#assistantMessageId(rec),
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
              messageId: this.#assistantMessageId(rec),
            });
          }
        }
        return;
      }
      case "modelMetadataEvent": {
        if (inner.usage) {
          // Providers like OpenAI/Moonshot report input inclusive of cache
          // reads; normalize to the additive shape so `in`/`cin` don't
          // double-count in the client's meter.
          const additive = toAdditiveUsage(inner.usage, rec.agent.model);
          rec.lastTurnUsage = lastTurnUsage(rec.lastTurnUsage, additive);
          rec.lastContextTokens = contextTokensFromUsage(additive);
          // Output tokens/sec over the generation window, excluding
          // time-to-first-token and any tool/approval time between requests.
          const genStartedAt = rec.genStartedAt;
          rec.genStartedAt = null;
          const outputTokens = additive.outputTokens ?? 0;
          rec.lastTokensPerSecond =
            genStartedAt !== null && outputTokens > 0
              ? outputTokens /
                Math.max((Date.now() - genStartedAt) / 1000, 0.001)
              : undefined;
          // Session cost accrues per request at the rates of the model that
          // served it; once a request with usage runs unpriced, the total is
          // incomplete and cost reporting stops for the session.
          if ((additive.totalTokens ?? 0) > 0) {
            if (rec.metadata?.costs) {
              rec.cumulativeCostUsd += computeUsageCostUsd(
                additive,
                rec.metadata.costs,
              );
            } else {
              rec.costUnpriced = true;
            }
          }
          // Push the accumulated-so-far usage after every request, not just
          // at turn end, so clients (e.g. VS Code) see the meter grow live
          // across a multi-request turn instead of jumping once at the end.
          await this.#sendUsageUpdate(client, sessionId, rec, undefined);
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
            messageId: this.#assistantMessageId(rec),
          });
        }
        return;
      }
      default:
        return;
    }
  }

  /** Lazily assign a `messageId` for the in-flight assistant message. */
  #assistantMessageId(rec: SessionRecord): string {
    if (!rec.currentAssistantMessageId) {
      rec.currentAssistantMessageId = crypto.randomUUID();
    }
    return rec.currentAssistantMessageId;
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
    mcpServers: SessionIndexEntry["mcpServers"],
    mode: SessionMode,
    preferredModel?: string,
    vscode = false,
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
    const steering = new ChatTurnSteeringController();
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
        interventions: [createChatTurnSteeringIntervention(steering)],
        createInterventions: () => [
          createAcpToolApprovalIntervention(
            client,
            sessionId,
            () =>
              this.#sessions.get(sessionId)?.streamedToolCallIds ??
              EMPTY_STREAMED_TOOL_CALL_IDS,
          ),
        ],
        // The session-title plugin generated an AI title (upgrading the
        // echo-derived placeholder): persist it and notify the client.
        onSessionTitle: async (title) => {
          await patchSessionEntry(this.#acpRoot, sessionId, { title });
          await this.#sendUpdate(client, sessionId, {
            sessionUpdate: "session_info_update",
            title,
            updatedAt: new Date().toISOString(),
          });
        },
        acp: {
          mcpServers: mcpServers ?? [],
          vscode,
          cwd,
        },
      },
      false,
      sessionConfig,
    );

    this.#registerTextFsBackend(agent, client, sessionId);
    this.#registerTerminalBackend(agent, client, sessionId);
    setAskUserBackend(agent, createAcpAskUserBackend(client, sessionId));
    setBrowserPreviewBackend(
      agent,
      createAcpBrowserPreviewBackend(client, sessionId),
    );

    const activeLlm = (config as SessionConfig).llm;
    const metadata = await resolveLlmMetadata(
      activeLlm.metadata,
      activeLlm.llmOptions.model,
      activeLlm.provider,
      configuredLlmContext(activeLlm),
    ).catch(() => null);
    setLlmModality(agent, metadata?.modality);

    return {
      cwd,
      agent,
      config: config as SessionConfig,
      mcpDisconnect: () => manager.disconnect().catch(() => undefined),
      turnAbort: null,
      promptExclusive: Promise.resolve(),
      steering,
      streamedToolCallIds: new Set(),
      streamingToolInputJson: new Map(),
      lastStreamToolUseId: null,
      terminalByToolCall: new Map(),
      shellJobs: new Map(),
      shellJobUnsub: null,
      currentAssistantMessageId: null,
      pendingModeReapply: false,
      pendingModelRebuild: false,
      pendingPersistModel: null,
      pendingPersistEffort: null,
      lastTurnUsage: createEmptyUsage(),
      metadata,
      cumulativeCostUsd: 0,
      costUnpriced: false,
      lastContextTokens: undefined,
      genStartedAt: null,
      lastTokensPerSecond: undefined,
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
      spawn: (request) => this.#spawnClientTerminal(client, sessionId, request),
      readOutput: (terminalId) =>
        this.#readClientTerminal(client, sessionId, terminalId),
      kill: (terminalId) =>
        this.#killClientTerminal(client, sessionId, terminalId),
    });
  }

  /** Call after the SessionRecord is stored in `#sessions`. */
  #subscribeShellJobs(
    agent: object,
    client: AgentContext,
    sessionId: string,
  ): void {
    const record = this.#sessions.get(sessionId);
    if (!record) {
      return;
    }
    record.shellJobUnsub?.();
    const manager = getShellJobManager(agent);
    record.shellJobUnsub = manager.on((event) => {
      void this.#onShellJobEvent(client, sessionId, event);
    });
  }

  async #onShellJobEvent(
    client: AgentContext,
    sessionId: string,
    event: ShellJobEvent,
  ): Promise<void> {
    if (
      event.type !== "completed" &&
      event.type !== "stopped" &&
      event.type !== "failed"
    ) {
      return;
    }

    const job = event.job;
    const meta = {
      "hoomanjs/shell_job": {
        event: event.type,
        job_id: job.id,
        description: job.description,
        status: job.status,
        ready: job.ready,
        exit_code: job.exitCode,
        signal: job.signal,
        terminal_id: job.terminalId,
        tool_call_id: job.toolUseId,
      },
    };

    // Meta-only update for the jobs bar — empty text so nothing lands in the
    // transcript. Fire-and-forget release: awaiting a nested terminal/* RPC
    // from inside stop_shell_job deadlocks the ACP connection.
    void this.#sendUpdate(client, sessionId, {
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        text: "",
      },
      _meta: meta,
    }).catch(() => undefined);

    const record = this.#sessions.get(sessionId);
    const hosted = record?.shellJobs.get(job.id);
    if (hosted) {
      record?.shellJobs.delete(job.id);
      void client
        .request(methods.client.terminal.release, {
          sessionId,
          terminalId: hosted.terminalId,
        })
        .catch(() => undefined);
    }
  }

  async #spawnClientTerminal(
    client: AgentContext,
    sessionId: string,
    request: TerminalRunRequest,
  ): Promise<TerminalSpawnResult> {
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
      { cancellationSignal: request.cancelSignal },
    );
    const terminalId = created.terminalId;
    const record = this.#sessions.get(sessionId);
    if (request.jobId && record) {
      record.shellJobs.set(request.jobId, {
        terminalId,
        toolCallId: request.toolUseId,
      });
    }
    if (request.toolUseId) {
      record?.terminalByToolCall.set(request.toolUseId, terminalId);
      await this.#sendUpdate(client, sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId: request.toolUseId,
        status: "in_progress",
        content: [{ type: "terminal", terminalId }],
      });
    }
    return { terminalId };
  }

  async #readClientTerminal(
    client: AgentContext,
    sessionId: string,
    terminalId: string,
  ): Promise<TerminalOutputSnapshot> {
    const output = await client.request(methods.client.terminal.output, {
      sessionId,
      terminalId,
    });
    return {
      output: output.output,
      truncated: output.truncated,
      exitCode: output.exitStatus?.exitCode ?? null,
      signal: output.exitStatus?.signal ?? null,
    };
  }

  async #killClientTerminal(
    client: AgentContext,
    sessionId: string,
    terminalId: string,
  ): Promise<void> {
    await client
      .request(methods.client.terminal.kill, { sessionId, terminalId })
      .catch(() => undefined);
  }

  async #teardownShellJobs(
    sessionId: string,
    record: SessionRecord,
  ): Promise<void> {
    record.shellJobUnsub?.();
    record.shellJobUnsub = null;
    const client = this.#client;
    for (const [jobId, hosted] of record.shellJobs) {
      if (client) {
        await client
          .request(methods.client.terminal.kill, {
            sessionId,
            terminalId: hosted.terminalId,
          })
          .catch(() => undefined);
        await client
          .request(methods.client.terminal.release, {
            sessionId,
            terminalId: hosted.terminalId,
          })
          .catch(() => undefined);
      }
      record.shellJobs.delete(jobId);
    }
    await clearShellJobManager(record.agent).catch(() => undefined);
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
    const entries = [...this.#sessions.entries()];
    this.#sessions.clear();
    for (const [sessionId, record] of entries) {
      record.turnAbort?.abort();
      await this.#teardownShellJobs(sessionId, record);
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
    .onRequest(methods.agent.session.resume, (ctx) =>
      agent.resumeSession(ctx.params, ctx.client),
    )
    .onRequest(methods.agent.session.close, (ctx) =>
      agent.closeSession(ctx.params),
    )
    .onRequest(methods.agent.session.list, (ctx) =>
      agent.listSessions(ctx.params),
    )
    .onRequest(methods.agent.session.delete, (ctx) =>
      agent.deleteSession(ctx.params),
    )
    .onRequest(methods.agent.session.fork, (ctx) =>
      agent.forkSession(ctx.params, ctx.client),
    )
    .onRequest(
      "_hoomanjs/rewind_session",
      (params) => params as RewindSessionRequest,
      (ctx) => agent.rewindSession(ctx.params),
    )
    .onRequest(
      "_hoomanjs/stop_shell_job",
      (params) => params as StopShellJobRequest,
      (ctx) => agent.stopShellJob(ctx.params),
    )
    .onRequest(methods.agent.session.setMode, (ctx) =>
      agent.setSessionMode(ctx.params, ctx.client),
    )
    .onRequest(methods.agent.session.setConfigOption, (ctx) =>
      agent.setSessionConfigOption(ctx.params, ctx.client),
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

/**
 * Pull a background shell job payload out of a Strands tool result.
 * The tool returns `{ status: "background", job_id, ... }` which the SDK wraps
 * as a ToolResultBlock with a json content block.
 */
function extractBackgroundShellFromResult(result: {
  content?: unknown;
  toJSON?: () => unknown;
}): { jobId: string; description?: string; jobStatus?: string } | null {
  const fromValue = (
    value: unknown,
  ): { jobId: string; description?: string; jobStatus?: string } | null => {
    if (!value || typeof value !== "object") {
      return null;
    }
    const record = value as Record<string, unknown>;
    if (record.status === "background" && typeof record.job_id === "string") {
      return {
        jobId: record.job_id,
        description:
          typeof record.description === "string"
            ? record.description
            : undefined,
        jobStatus:
          typeof record.job_status === "string" ? record.job_status : undefined,
      };
    }
    return null;
  };

  if (Array.isArray(result.content)) {
    for (const block of result.content) {
      if (!block || typeof block !== "object") {
        continue;
      }
      const json = (block as { json?: unknown; type?: string }).json;
      const nested = fromValue(json ?? block);
      if (nested) {
        return nested;
      }
    }
  }

  try {
    const serialized = result.toJSON?.();
    if (serialized && typeof serialized === "object") {
      const wrapped = serialized as {
        toolResult?: { content?: unknown[] };
        content?: unknown[];
      };
      const content = wrapped.toolResult?.content ?? wrapped.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== "object") {
            continue;
          }
          const json = (block as { json?: unknown }).json;
          const nested = fromValue(json ?? block);
          if (nested) {
            return nested;
          }
        }
      }
      const direct = fromValue(serialized);
      if (direct) {
        return direct;
      }
    }
  } catch {
    // ignore serialization errors
  }

  return null;
}
