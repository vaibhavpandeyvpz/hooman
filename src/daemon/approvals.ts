import type { Agent, BeforeToolCallEvent } from "@strands-agents/sdk";
import type { Manager as McpManager } from "../core/mcp/index.js";
import {
  INTERNAL_ALWAYS_ALLOWED,
  allowToolForSession,
  isToolSessionAllowed,
} from "../core/state/tool-approvals.js";

const TOOL_DESCRIPTION_PREVIEW_LIMIT = 50;
const TOOL_ARGS_PREVIEW_LIMIT = 50;

type ChannelOrigin = {
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

function readOrigin(agent: Agent): ChannelOrigin | null {
  const raw = agent.appState.get("origin");
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

export function createDaemonApprovalHandler(
  manager: McpManager,
  agent: Agent,
  options?: { yolo?: boolean },
): (event: BeforeToolCallEvent) => Promise<void> {
  return async (event: BeforeToolCallEvent) => {
    const name = event.toolUse.name;
    if (options?.yolo) {
      return;
    }
    if (
      INTERNAL_ALWAYS_ALLOWED.has(name) ||
      isToolSessionAllowed(event.agent, name)
    ) {
      return;
    }

    const origin = readOrigin(agent);
    if (!origin?.server) {
      event.cancel = `Tool "${name}" was denied: missing daemon origin context.`;
      return;
    }

    const supported = await manager.supportsChannelPermission(origin.server);
    if (!supported) {
      event.cancel = `Tool "${name}" was denied: MCP server "${origin.server}" does not support hooman/channel/permission.`;
      return;
    }

    let behavior: "allow_once" | "allow_always" | "deny";
    try {
      behavior = await manager.requestChannelPermission(origin.server, {
        requestId: randomRequestId(),
        tool: name,
        description: truncateWithEllipsis(
          event.tool?.description?.trim() ??
            `Run tool "${name}" in daemon mode.`,
          TOOL_DESCRIPTION_PREVIEW_LIMIT,
        ),
        preview: inputPreview(event.toolUse.input),
        source: origin.source,
        user: origin.user,
        session: origin.session,
        thread: origin.thread,
      });
    } catch (error) {
      event.cancel = `Tool "${name}" was denied: failed to request permission (${error instanceof Error ? error.message : String(error)}).`;
      return;
    }

    if (behavior === "allow_once") {
      return;
    }
    if (behavior === "allow_always") {
      allowToolForSession(event.agent, name);
      return;
    }

    event.cancel = `Tool "${name}" was rejected by remote approval.`;
  };
}
