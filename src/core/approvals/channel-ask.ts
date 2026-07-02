import type { Manager as McpManager } from "../mcp/index.js";
import type { ToolApprovalAsk } from "./intervention.js";

const TOOL_DESCRIPTION_PREVIEW_LIMIT = 50;
const TOOL_ARGS_PREVIEW_LIMIT = 50;

/** Metadata a channel-driven job (daemon, bot, etc.) stashes on `appState.origin`. */
export type ChannelOrigin = {
  server?: string;
  source?: string;
  user?: string;
  session?: string;
  thread?: string;
};

function randomRequestId(): string {
  return crypto.randomUUID();
}

function truncateWithEllipsis(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function truncateWithHiddenCharCount(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  const hidden = text.length - max;
  return `${text.slice(0, max)}…(${hidden} chars)`;
}

function inputPreview(input: unknown): string {
  try {
    const text = JSON.stringify(input) ?? "null";
    return truncateWithHiddenCharCount(text, TOOL_ARGS_PREVIEW_LIMIT);
  } catch {
    return truncateWithHiddenCharCount(String(input), TOOL_ARGS_PREVIEW_LIMIT);
  }
}

/** Reads the `origin` an {@link McpManager}-backed channel job stashes on `appState`. */
export function readChannelOrigin(rawAgent: {
  appState: { get(key: string): unknown };
}): ChannelOrigin | null {
  const raw = rawAgent.appState.get("origin");
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const entry = raw as Record<string, unknown>;
  const text = (value: unknown): string | undefined => {
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };
  return {
    server: text(entry.server),
    source: text(entry.source),
    user: text(entry.user),
    session: text(entry.session),
    thread: text(entry.thread),
  };
}

/**
 * Builds a {@link ToolApprovalAsk} that resolves tool approvals over
 * `hooman/channel/permission` — the remote-approval capability MCP servers
 * advertise for channel-driven jobs (daemon mode, chat bots, etc.) that have
 * no local human to prompt. Pair with {@link HoomanToolApprovalIntervention}.
 *
 * Requires the job's `appState.origin` to carry the originating channel
 * server name (see {@link readChannelOrigin}); jobs without one, or servers
 * that don't support the capability, are rejected.
 */
export function createChannelPermissionAsk(
  manager: McpManager,
): ToolApprovalAsk {
  return async (request, event) => {
    const origin = readChannelOrigin(event.agent);
    if (!origin?.server) {
      return {
        decision: "reject",
        reason: `Tool "${request.toolName}" was denied: missing channel origin context.`,
      };
    }

    const supported = await manager.supportsChannelPermission(origin.server);
    if (!supported) {
      return {
        decision: "reject",
        reason: `Tool "${request.toolName}" was denied: MCP server "${origin.server}" does not support hooman/channel/permission.`,
      };
    }

    try {
      const behavior = await manager.requestChannelPermission(origin.server, {
        requestId: randomRequestId(),
        tool: request.toolName,
        description: truncateWithEllipsis(
          request.description?.trim() ??
            `Run tool "${request.toolName}" via channel.`,
          TOOL_DESCRIPTION_PREVIEW_LIMIT,
        ),
        preview: inputPreview(request.input),
        source: origin.source,
        user: origin.user,
        session: origin.session,
        thread: origin.thread,
      });

      if (behavior === "allow_once") {
        return "allow";
      }
      if (behavior === "allow_always") {
        return "always";
      }
      return {
        decision: "reject",
        reason: `Tool "${request.toolName}" was rejected by remote approval.`,
      };
    } catch (error) {
      return {
        decision: "reject",
        reason: `Tool "${request.toolName}" was denied: failed to request permission (${error instanceof Error ? error.message : String(error)}).`,
      };
    }
  };
}
