import type { Agent, BeforeToolCallEvent } from "@strands-agents/sdk";
import type { Config } from "../core/config.ts";
import type { Manager as McpManager } from "../core/mcp/index.ts";
import { INTERNAL_ALWAYS_ALLOWED } from "../acp/utils/tool-kind.ts";

const INPUT_PREVIEW_LIMIT = 1_024;

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

function inputPreview(input: unknown): string {
  try {
    const text = JSON.stringify(input, null, 2) ?? "null";
    return text.length > INPUT_PREVIEW_LIMIT
      ? `${text.slice(0, INPUT_PREVIEW_LIMIT)}\n... (truncated)`
      : text;
  } catch {
    return String(input);
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
  config: Config,
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
      config.tools.allowed.includes(name)
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
        description:
          event.tool?.description?.trim() ??
          `Run tool "${name}" in daemon mode.`,
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
      if (!config.tools.allowed.includes(name)) {
        config.update({ tools: { allowed: [...config.tools.allowed, name] } });
      }
      return;
    }

    event.cancel = `Tool "${name}" was rejected by remote approval.`;
  };
}
