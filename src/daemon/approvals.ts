import type {
  PermissionOption,
  PermissionOptionKind,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";
import { ACP_ASK_USER_META_KEY } from "../acp/questions.js";
import type { Manager as McpManager } from "../core/mcp/index.js";
import type { DaemonSessionRegistry } from "./session-registry.js";

const TOOL_DESCRIPTION_PREVIEW_LIMIT = 64;
const TOOL_ARGS_PREVIEW_LIMIT = 200;

const CANCELLED: RequestPermissionResponse = {
  outcome: { outcome: "cancelled" },
};

function selected(optionId: string): RequestPermissionResponse {
  return { outcome: { outcome: "selected", optionId } };
}

function pickOptionByKind(
  options: readonly PermissionOption[],
  kind: PermissionOptionKind,
): string | undefined {
  return options.find((option) => option.kind === kind)?.optionId;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function inputPreview(input: unknown): string {
  try {
    return truncate(JSON.stringify(input) ?? "null", TOOL_ARGS_PREVIEW_LIMIT);
  } catch {
    return truncate(String(input), TOOL_ARGS_PREVIEW_LIMIT);
  }
}

/**
 * Exact tool name and raw description the ACP server attaches to
 * `session/request_permission` via `_meta` (see `src/acp/approvals.ts`), so
 * the channel gets a minimal "tool name + description + input" message
 * instead of the display `title` (which already folds them together for
 * ACP UI clients). Falls back to `toolCall.title`/`toolCallId` only for
 * non-conforming callers.
 */
function extractToolMeta(request: RequestPermissionRequest): {
  name: string;
  description: string;
} {
  const meta = request._meta as Record<string, unknown> | undefined;
  const metaName = meta?.["hoomanjs/tool_name"];
  const metaDescription = meta?.["hoomanjs/tool_description"];
  const name =
    typeof metaName === "string" && metaName.trim()
      ? metaName.trim()
      : request.toolCall.title?.trim() || request.toolCall.toolCallId;
  const description =
    typeof metaDescription === "string" ? metaDescription.trim() : "";
  return {
    name,
    description: truncate(description, TOOL_DESCRIPTION_PREVIEW_LIMIT),
  };
}

/**
 * Relays a tool-approval `session/request_permission` to the exact upstream
 * MCP server that originated the current turn's channel notification, over
 * `hooman/channel/permission`. Unsupported/missing capability or origin
 * safely denies via a `cancelled` outcome — never broadcasts to other
 * upstream servers.
 */
async function relayToolApproval(
  manager: McpManager,
  registry: DaemonSessionRegistry,
  sessionId: string,
  request: RequestPermissionRequest,
  _signal: AbortSignal,
): Promise<RequestPermissionResponse> {
  const origin = registry.originForAcpSession(sessionId);
  if (!origin?.server) {
    return CANCELLED;
  }
  const supported = await manager.supportsChannelPermission(origin.server);
  if (!supported) {
    return CANCELLED;
  }
  try {
    const { name, description } = extractToolMeta(request);
    const behavior = await manager.requestChannelPermission(origin.server, {
      requestId: crypto.randomUUID(),
      tool: name,
      description,
      preview: inputPreview(request.toolCall.rawInput),
      source: origin.source,
      user: origin.user,
      session: origin.session,
      thread: origin.thread,
    });
    if (behavior === "allow_once") {
      const optionId = pickOptionByKind(request.options, "allow_once");
      return optionId ? selected(optionId) : CANCELLED;
    }
    if (behavior === "allow_always") {
      const optionId =
        pickOptionByKind(request.options, "allow_always") ??
        pickOptionByKind(request.options, "allow_once");
      return optionId ? selected(optionId) : CANCELLED;
    }
    return CANCELLED;
  } catch {
    return CANCELLED;
  }
}

/**
 * Relays an `ask_user` question (the same `session/request_permission`
 * method, tagged with `_meta[ACP_ASK_USER_META_KEY]`) over
 * `hooman/channel/ask`. Maps the channel's answer back to the offered
 * `answer_N` option by matching its resolved label; free text that doesn't
 * match an offered option is treated as a dismissal, matching how the ACP
 * server-side `ask_user` backend itself only understands option IDs or
 * dismissal.
 */
async function relayAskUser(
  manager: McpManager,
  registry: DaemonSessionRegistry,
  sessionId: string,
  request: RequestPermissionRequest,
  signal: AbortSignal,
): Promise<RequestPermissionResponse> {
  const origin = registry.originForAcpSession(sessionId);
  if (!origin?.server) {
    return CANCELLED;
  }
  const supported = await manager.supportsChannelAsk(origin.server);
  if (!supported) {
    return CANCELLED;
  }
  const rawInput = request.toolCall.rawInput as
    { question?: unknown; options?: unknown } | undefined;
  const question =
    typeof rawInput?.question === "string"
      ? rawInput.question
      : request.toolCall.title?.trim() || "Question";
  const options = Array.isArray(rawInput?.options)
    ? (rawInput.options as unknown[]).filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  try {
    const outcome = await manager.requestChannelAsk(
      origin.server,
      {
        requestId: crypto.randomUUID(),
        question,
        options,
        source: origin.source,
        user: origin.user,
        session: origin.session,
        thread: origin.thread,
      },
      { signal },
    );
    if (outcome.kind === "dismissed") {
      return CANCELLED;
    }
    const index = options.indexOf(outcome.answer);
    if (index < 0) {
      return CANCELLED;
    }
    const optionId = `answer_${index}`;
    return request.options.some((option) => option.optionId === optionId)
      ? selected(optionId)
      : CANCELLED;
  } catch {
    return CANCELLED;
  }
}

/**
 * Builds the daemon ACP client's `session/request_permission` handler,
 * dispatching to the tool-approval or `ask_user` relay and always resolving
 * to the originating upstream server the current turn's origin snapshot
 * points at.
 */
export function createDaemonPermissionHandler(
  manager: McpManager,
  registry: DaemonSessionRegistry,
) {
  return (
    sessionId: string,
    request: RequestPermissionRequest,
    signal: AbortSignal,
  ): Promise<RequestPermissionResponse> => {
    const isAskUser = request._meta?.[ACP_ASK_USER_META_KEY] === true;
    return isAskUser
      ? relayAskUser(manager, registry, sessionId, request, signal)
      : relayToolApproval(manager, registry, sessionId, request, signal);
  };
}
