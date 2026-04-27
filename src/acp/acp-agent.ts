import path from "node:path";
import { readFile } from "node:fs/promises";
import { Readable, Writable } from "node:stream";
import { stdin, stdout } from "node:process";
import type {
  Agent as AgentContract,
  PromptResponse,
  SetSessionConfigOptionResponse,
  StopReason,
} from "@agentclientprotocol/sdk";
import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
} from "@agentclientprotocol/sdk";
import type { Agent as StrandsAgent } from "@strands-agents/sdk";
import {
  BeforeToolCallEvent,
  isModelStreamEvent,
  Message,
  type MessageData,
  ModelStreamUpdateEvent,
} from "@strands-agents/sdk";
import type { StopReason as StrandsStopReason } from "@strands-agents/sdk";
import { bootstrap } from "../core/index.js";
import { runWithCwd } from "../core/utils/cwd-context.js";
import { acpSessionsRootPath } from "./utils/paths.js";
import { inferToolKind } from "./utils/tool-kind.js";
import { toolResultToAcpContent } from "./utils/tool-result-content.js";
import { createAcpToolApprovalHook } from "./approvals.js";
import { replayConversationHistory } from "./sessions/replay.js";
import {
  applySessionConfigOption,
  buildSessionConfigOptions,
} from "./sessions/config-options.js";
import { extractAcpClientSystemPrompt } from "./meta/system-prompt.js";
import { extractAcpClientUserId } from "./meta/user-id.js";
import { deriveSessionTitleFromEcho } from "./sessions/title.js";
import { acpPromptEchoText, acpPromptToInvokeArgs } from "./prompt-invoke.js";
import type { Config } from "../core/config.js";
import { normalizeAcpSessionMcpServers } from "./mcp-servers.js";
import {
  consumeExitRequest,
  EXIT_REQUESTED_CODE,
} from "../core/state/exit-request.js";
import {
  listStoredSessionIds,
  loadSessionMessages,
  patchSessionMeta,
  readSessionMeta,
  saveSessionMessages,
  toSessionInfo,
  writeSessionMeta,
  type SessionMetaFile,
} from "./sessions/store.js";

const DEFAULT_MODE_ID = "default" as const;
const LIST_PAGE_SIZE = 40;

/** Fallback when a session record is missing (never mutate). */
const EMPTY_STREAMED_TOOL_CALL_IDS = new Set<string>();

type SessionRecord = {
  cwd: string;
  agent: StrandsAgent;
  config: Config;
  currentModeId: string;
  readonly availableModeIds: ReadonlySet<string>;
  mcpDisconnect: () => Promise<void>;
  hookOff: () => void;
  turnAbort: AbortController | null;
  /** Chains `prompt` turns so concurrent RPCs for the same session serialize. */
  promptExclusive: Promise<void>;
  /** Tool calls that already received `tool_call` from the model stream this turn. */
  streamedToolCallIds: Set<string>;
  /** Incremental JSON fragments for `toolUseInputDelta` keyed by `toolUseId`. */
  streamingToolInputJson: Map<string, string>;
  /** Latest tool use block seen in the model stream (sequential tool calls). */
  lastStreamToolUseId: string | null;
};

function negotiateProtocolVersion(clientVersion: number): number {
  if (!Number.isFinite(clientVersion) || clientVersion < 1) {
    return PROTOCOL_VERSION;
  }
  return clientVersion > PROTOCOL_VERSION ? PROTOCOL_VERSION : clientVersion;
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

function parseStreamingToolJson(buffer: string): unknown {
  try {
    return JSON.parse(buffer) as unknown;
  } catch {
    return { _partialJson: buffer };
  }
}

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

async function readPackageDetails(): Promise<{
  name: string;
  version: string;
}> {
  const packageUrl = new URL("../../package.json", import.meta.url);
  const pkg = JSON.parse(await readFile(packageUrl, "utf8")) as {
    bin?: string | Record<string, string>;
    name?: string;
    version?: string;
  };
  const commandName =
    typeof pkg.bin === "string"
      ? pkg.name
      : pkg.bin && typeof pkg.bin === "object"
        ? Object.keys(pkg.bin)[0]
        : undefined;
  return {
    name: commandName ?? pkg.name ?? "hooman",
    version: pkg.version ?? "0.0.0",
  };
}

export class AcpAgent implements AgentContract {
  readonly #connection: AgentSideConnection;
  readonly #sessions = new Map<string, SessionRecord>();
  readonly #acpRoot: string;
  #version: string | null = null;

  constructor(connection: AgentSideConnection) {
    this.#connection = connection;
    this.#acpRoot = acpSessionsRootPath();
    queueMicrotask(() => {
      if (connection.signal.aborted) {
        void this.#disposeAllSessions();
        return;
      }
      connection.signal.addEventListener(
        "abort",
        () => {
          void this.#disposeAllSessions();
        },
        { once: true },
      );
    });
  }

  async initialize(params: Parameters<AgentContract["initialize"]>[0]) {
    const { name, version } = await readPackageDetails();
    this.#version ??= version;
    return {
      protocolVersion: negotiateProtocolVersion(params.protocolVersion),
      agentInfo: {
        name,
        title: name,
        version: this.#version,
      },
      authMethods: [],
      agentCapabilities: {
        loadSession: true,
        mcpCapabilities: {
          http: true,
          sse: true,
        },
        promptCapabilities: {
          embeddedContext: true,
          image: true,
          audio: true,
        },
        sessionCapabilities: {
          list: {},
        },
      },
    };
  }

  async authenticate(_params: Parameters<AgentContract["authenticate"]>[0]) {
    return {};
  }

  async setSessionMode(
    params: Parameters<NonNullable<AgentContract["setSessionMode"]>>[0],
  ) {
    const rec = this.#sessions.get(params.sessionId);
    if (!rec) {
      throw RequestError.invalidParams({ sessionId: params.sessionId });
    }
    if (!rec.availableModeIds.has(params.modeId)) {
      throw RequestError.invalidParams({ modeId: params.modeId });
    }
    rec.currentModeId = params.modeId;
    return {};
  }

  async setSessionConfigOption(
    params: Parameters<NonNullable<AgentContract["setSessionConfigOption"]>>[0],
  ): Promise<SetSessionConfigOptionResponse> {
    const rec = this.#sessions.get(params.sessionId);
    if (!rec) {
      throw RequestError.invalidParams({ sessionId: params.sessionId });
    }
    applySessionConfigOption(rec.config, params);
    return { configOptions: buildSessionConfigOptions(rec.config) };
  }

  async extMethod(
    method: string,
    _params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    throw RequestError.methodNotFound(method);
  }

  async extNotification(
    _method: string,
    _params: Record<string, unknown>,
  ): Promise<void> {
    return;
  }

  async listSessions(
    params: Parameters<NonNullable<AgentContract["listSessions"]>>[0],
  ) {
    void params.additionalDirectories;
    const ids = await listStoredSessionIds(this.#acpRoot);
    const rows: Array<{
      id: string;
      info: NonNullable<Awaited<ReturnType<typeof toSessionInfo>>>;
    }> = [];
    for (const id of ids) {
      const info = await toSessionInfo(this.#acpRoot, id);
      if (info) {
        rows.push({ id, info });
      }
    }
    let filtered = rows;
    if (params.cwd) {
      filtered = rows.filter((r) => r.info.cwd === params.cwd);
    }
    filtered.sort((a, b) =>
      String(b.info.updatedAt ?? "").localeCompare(
        String(a.info.updatedAt ?? ""),
      ),
    );
    let offset = 0;
    if (params.cursor) {
      try {
        const raw = Buffer.from(params.cursor, "base64").toString("utf8");
        const o = JSON.parse(raw) as { offset?: number };
        offset = Number.isFinite(o.offset) ? Math.max(0, o.offset!) : 0;
      } catch {
        offset = 0;
      }
    }
    const slice = filtered
      .slice(offset, offset + LIST_PAGE_SIZE)
      .map((r) => r.info);
    const nextOffset = offset + LIST_PAGE_SIZE;
    const nextCursor =
      nextOffset < filtered.length
        ? Buffer.from(JSON.stringify({ offset: nextOffset }), "utf8").toString(
            "base64",
          )
        : null;
    return { sessions: slice, nextCursor };
  }

  async newSession(params: Parameters<AgentContract["newSession"]>[0]) {
    assertAbsolutePath(params.cwd, "cwd");
    const sessionId = crypto.randomUUID();
    const clientUserId = extractAcpClientUserId(params._meta) ?? null;
    const clientSystemPrompt =
      extractAcpClientSystemPrompt(params._meta) ?? null;
    const bootstrapUserId = clientUserId ?? sessionId;
    const mcpServers = normalizeAcpSessionMcpServers(params.mcpServers);

    const now = new Date().toISOString();
    const meta: SessionMetaFile = {
      cwd: params.cwd,
      createdAt: now,
      updatedAt: now,
      title: null,
      userId: clientUserId,
      systemPrompt: clientSystemPrompt,
      mcpServers,
    };
    await writeSessionMeta(this.#acpRoot, sessionId, meta);

    const {
      config,
      agent,
      mcp: { manager },
    } = await bootstrap(
      "acp",
      {
        userId: bootstrapUserId,
        sessionId,
        acp: {
          mcpServers,
          ...(clientSystemPrompt ? { systemPrompt: clientSystemPrompt } : {}),
        },
      },
      false,
    );

    const availableModeIds = new Set<string>([DEFAULT_MODE_ID]);

    const hookOff = agent.addHook(
      BeforeToolCallEvent,
      createAcpToolApprovalHook(
        this.#connection,
        sessionId,
        () =>
          this.#sessions.get(sessionId)?.streamedToolCallIds ??
          EMPTY_STREAMED_TOOL_CALL_IDS,
      ),
    );

    this.#sessions.set(sessionId, {
      cwd: params.cwd,
      agent,
      config,
      currentModeId: DEFAULT_MODE_ID,
      availableModeIds,
      hookOff,
      mcpDisconnect: async () => {
        try {
          await manager.disconnect();
        } catch {
          /* ignore */
        }
      },
      turnAbort: null,
      promptExclusive: Promise.resolve(),
      streamedToolCallIds: new Set(),
      streamingToolInputJson: new Map(),
      lastStreamToolUseId: null,
    });

    return {
      sessionId,
      modes: {
        currentModeId: DEFAULT_MODE_ID,
        availableModes: [
          {
            id: DEFAULT_MODE_ID,
            name: "Default",
            description: "Standard Hooman behaviour for this session.",
          },
        ],
      },
      models: null,
      configOptions: buildSessionConfigOptions(config),
    };
  }

  async loadSession(
    params: Parameters<NonNullable<AgentContract["loadSession"]>>[0],
  ) {
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
    const requestedSystemPrompt = extractAcpClientSystemPrompt(params._meta);
    const storedUserId = existing.userId ?? null;
    const storedSystemPrompt = existing.systemPrompt ?? null;
    const clientUserId = fromRequest !== undefined ? fromRequest : storedUserId;
    const clientSystemPrompt =
      requestedSystemPrompt !== undefined
        ? requestedSystemPrompt
        : storedSystemPrompt;
    const bootstrapUserId = clientUserId ?? params.sessionId;
    const mcpServers =
      params.mcpServers.length > 0
        ? normalizeAcpSessionMcpServers(params.mcpServers)
        : (existing.mcpServers ?? []);

    const {
      config,
      agent,
      mcp: { manager },
    } = await bootstrap(
      "acp",
      {
        userId: bootstrapUserId,
        sessionId: params.sessionId,
        acp: {
          mcpServers,
          ...(clientSystemPrompt ? { systemPrompt: clientSystemPrompt } : {}),
        },
      },
      false,
    );

    const saved = await loadSessionMessages(this.#acpRoot, params.sessionId);
    agent.messages.length = 0;
    for (const md of saved) {
      agent.messages.push(Message.fromJSON(md));
    }

    await replayConversationHistory(
      this.#connection,
      params.sessionId,
      agent.messages,
    );

    const availableModeIds = new Set<string>([DEFAULT_MODE_ID]);
    const hookOff = agent.addHook(
      BeforeToolCallEvent,
      createAcpToolApprovalHook(
        this.#connection,
        params.sessionId,
        () =>
          this.#sessions.get(params.sessionId)?.streamedToolCallIds ??
          EMPTY_STREAMED_TOOL_CALL_IDS,
      ),
    );

    this.#sessions.set(params.sessionId, {
      cwd: params.cwd,
      agent,
      config,
      currentModeId: DEFAULT_MODE_ID,
      availableModeIds,
      hookOff,
      mcpDisconnect: async () => {
        try {
          await manager.disconnect();
        } catch {
          /* ignore */
        }
      },
      turnAbort: null,
      promptExclusive: Promise.resolve(),
      streamedToolCallIds: new Set(),
      streamingToolInputJson: new Map(),
      lastStreamToolUseId: null,
    });

    await patchSessionMeta(this.#acpRoot, params.sessionId, {
      cwd: params.cwd,
      updatedAt: new Date().toISOString(),
      ...(fromRequest !== undefined ? { userId: fromRequest || null } : {}),
      ...(requestedSystemPrompt !== undefined
        ? { systemPrompt: requestedSystemPrompt || null }
        : {}),
      mcpServers,
    });

    return {
      modes: {
        currentModeId: DEFAULT_MODE_ID,
        availableModes: [
          {
            id: DEFAULT_MODE_ID,
            name: "Default",
            description: "Standard Hooman behaviour for this session.",
          },
        ],
      },
      models: null,
      configOptions: buildSessionConfigOptions(config),
    };
  }

  async cancel(params: Parameters<AgentContract["cancel"]>[0]) {
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

  async prompt(params: Parameters<AgentContract["prompt"]>[0]) {
    const rec = this.#sessions.get(params.sessionId);
    if (!rec) {
      throw RequestError.invalidParams({ sessionId: params.sessionId });
    }

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
        await this.#connection.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: echo },
          },
        });
        const meta = await readSessionMeta(this.#acpRoot, params.sessionId);
        const needsTitle =
          meta &&
          (meta.title === undefined ||
            meta.title === null ||
            String(meta.title).trim() === "");
        if (needsTitle) {
          const title = deriveSessionTitleFromEcho(echo);
          if (title) {
            await patchSessionMeta(this.#acpRoot, params.sessionId, { title });
            await this.#connection.sessionUpdate({
              sessionId: params.sessionId,
              update: {
                sessionUpdate: "session_info_update",
                title,
                updatedAt: new Date().toISOString(),
              },
            });
          }
        }
      }

      const invokeArgs = acpPromptToInvokeArgs(params.prompt);
      const cancelSignal = AbortSignal.any([
        this.#connection.signal,
        turnAbort.signal,
      ]);

      try {
        await runWithCwd(rec.cwd, async () => {
          const stream = rec.agent.stream(invokeArgs, { cancelSignal });
          let iter = await stream.next();
          while (!iter.done) {
            const ev = iter.value;

            if (ev.type === "modelStreamUpdateEvent") {
              await this.#dispatchModelStreamUpdate(params.sessionId, ev, rec);
            } else if (ev.type === "afterToolCallEvent") {
              await this.#connection.sessionUpdate({
                sessionId: params.sessionId,
                update: {
                  sessionUpdate: "tool_call_update",
                  toolCallId: ev.toolUse.toolUseId,
                  status:
                    ev.result.status === "success" ? "completed" : "failed",
                  rawOutput: ev.result.toJSON() as unknown,
                  content: toolResultToAcpContent(ev.result),
                },
              });
            } else if (ev.type === "agentResultEvent") {
              stopReason = toAcpStopReason(ev.result.stopReason);
            }

            iter = await stream.next();
          }
        });
      } catch (err) {
        const cancelSignals = [
          cancelSignal,
          turnAbort.signal,
          this.#connection.signal,
        ] as const;
        if (isCancellationError(err, cancelSignals)) {
          stopReason = "cancelled";
        } else {
          const message = err instanceof Error ? err.message : String(err);
          await this.#connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: {
                type: "text",
                text: `\n[error] ${message}\n`,
              },
            },
          });
          stopReason = "refusal";
        }
      }
    } finally {
      rec.turnAbort = null;
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
      await this.#disposeAllSessions();
      setTimeout(() => process.exit(EXIT_REQUESTED_CODE), 25);
    }

    return { stopReason } satisfies PromptResponse;
  }

  async #dispatchModelStreamUpdate(
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
          await this.#connection.sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "tool_call",
              toolCallId: start.toolUseId,
              title: start.name,
              kind: inferToolKind(start.name),
              status: "pending",
              rawInput: {},
            },
          });
        }
        return;
      }
      case "modelContentBlockDeltaEvent": {
        const { delta } = inner;
        if (delta.type === "textDelta" && delta.text) {
          await this.#connection.sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: delta.text },
            },
          });
          return;
        }
        if (delta.type === "reasoningContentDelta") {
          if (delta.text) {
            await this.#connection.sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: "agent_thought_chunk",
                content: { type: "text", text: delta.text },
              },
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
          await this.#connection.sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: toolUseId,
              rawInput: parseStreamingToolJson(next),
            },
          });
          return;
        }
        if (delta.type === "citationsDelta") {
          const n = delta.citations?.length ?? 0;
          if (n > 0) {
            await this.#connection.sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: "agent_thought_chunk",
                content: {
                  type: "text",
                  text: `[citations: ${n} reference(s)]\n`,
                },
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
          await this.#connection.sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: replace },
            },
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

  async #disposeAllSessions(): Promise<void> {
    const ids = [...this.#sessions.keys()];
    for (const id of ids) {
      await this.#destroySession(id);
    }
  }

  async #destroySession(sessionId: string): Promise<void> {
    const rec = this.#sessions.get(sessionId);
    if (!rec) {
      return;
    }
    rec.turnAbort?.abort();
    try {
      rec.agent.cancel();
    } catch {
      /* ignore */
    }
    rec.hookOff();
    await rec.mcpDisconnect();
    this.#sessions.delete(sessionId);
  }
}

export async function runAcpStdio(): Promise<void> {
  const stream = ndJsonStream(
    Writable.toWeb(stdout) as unknown as WritableStream<Uint8Array>,
    Readable.toWeb(stdin) as unknown as ReadableStream<Uint8Array>,
  );
  const connection = new AgentSideConnection(
    (conn) => new AcpAgent(conn),
    stream,
  );
  await connection.closed;
}
