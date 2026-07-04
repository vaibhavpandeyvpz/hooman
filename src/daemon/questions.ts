import { readChannelOrigin } from "../core/approvals/channel-ask.js";
import type { Manager as McpManager } from "../core/mcp/index.js";
import type { AskUserBackend } from "../core/tools/ask-user.js";

/**
 * `ask_user` backend for channel-driven daemon jobs: relays the question to
 * the originating MCP server over the `hooman/channel/ask` capability (the
 * question-flavoured sibling of `hooman/channel/permission`), so the server
 * can surface it wherever the human actually is — a Slack thread, a Telegram
 * chat, etc. — and post the answer back.
 *
 * Jobs without a channel origin, and servers that don't advertise the
 * capability, report "unavailable" so the model proceeds on its own
 * judgement, matching daemon behaviour before this backend existed.
 */
export function createDaemonAskUserBackend(
  manager: McpManager,
  agent: { appState: { get(key: string): unknown } },
): AskUserBackend {
  return {
    ask: async (request) => {
      const origin = readChannelOrigin(agent);
      if (!origin?.server) {
        return { kind: "unavailable" };
      }
      const supported = await manager
        .supportsChannelAsk(origin.server)
        .catch(() => false);
      if (!supported) {
        return { kind: "unavailable" };
      }
      try {
        return await manager.requestChannelAsk(
          origin.server,
          {
            requestId: crypto.randomUUID(),
            question: request.question,
            options: request.options,
            source: origin.source,
            user: origin.user,
            session: origin.session,
            thread: origin.thread,
          },
          { signal: request.signal },
        );
      } catch {
        // Relay failed or timed out; let the model proceed on its own.
        return { kind: "unavailable" };
      }
    },
  };
}
