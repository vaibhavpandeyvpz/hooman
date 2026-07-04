import {
  AfterInvocationEvent,
  HookOrder,
  MessageAddedEvent,
  type LocalAgent,
  type Plugin,
} from "@strands-agents/sdk";
import { generateSessionTitle } from "../sessions/generate-title.js";
import { getSessionTitle, setSessionTitle } from "../state/session-title.js";

/** Invoked once per session after a generated title lands on appState. */
export type SessionTitleCallback = (title: string) => void | Promise<void>;

/**
 * Plugin that gives every session an AI-generated title from its first user
 * prompt, a common pattern across AI coding assistants.
 *
 * - `MessageAddedEvent`: when a real user message (text, no tool results)
 *   lands and no title exists on appState (`hooman.title`), kick off a
 *   side-call to the agent's current model. Runs concurrently with the turn.
 * - `AfterInvocationEvent` (order `SDK_FIRST - 1`, i.e. before the session
 *   managers' snapshot-save hooks): await the pending generation and stage
 *   the title on appState, so the turn's own snapshot save persists it into
 *   `data.state` — no extra file I/O, and for shared agents (daemon) the
 *   appState still belongs to the right session because the await happens
 *   inside the turn.
 *
 * Generation is best-effort: on failure/timeout the surface's fallback title
 * (echo/first prompt line) simply stays, and the next user turn retries.
 *
 * `onTitle` lets surfaces react beyond snapshot persistence (ACP patches its
 * `meta.json` and pushes a `session_info_update` to the client).
 */
export function createSessionTitlePlugin(
  options: {
    onTitle?: SessionTitleCallback;
    timeoutMs?: number;
  } = {},
): Plugin {
  return {
    name: "hooman:session-title",
    initAgent(agent: LocalAgent): void {
      let pending: Promise<string | null> | null = null;

      agent.addHook(MessageAddedEvent, (event) => {
        if (pending || getSessionTitle(event.agent) !== null) {
          return;
        }
        const message = event.message;
        if (message.role !== "user") {
          return;
        }
        // Tool results come back as user messages; don't title from those.
        if (message.content.some((b) => b.type === "toolResultBlock")) {
          return;
        }
        const text = message.content
          .filter((b) => b.type === "textBlock")
          .map((b) => b.text)
          .join("\n")
          .trim();
        if (!text) {
          return;
        }
        pending = generateSessionTitle(event.agent.model, text, {
          timeoutMs: options.timeoutMs,
        });
      });

      agent.addHook(
        AfterInvocationEvent,
        async (event) => {
          if (!pending) {
            return;
          }
          const work = pending;
          pending = null;
          const title = await work;
          if (!title || getSessionTitle(event.agent) !== null) {
            return;
          }
          setSessionTitle(event.agent, title);
          try {
            await options.onTitle?.(title);
          } catch {
            // Notification is best-effort; the title is already staged.
          }
        },
        // Before SDK-registered hooks so the session manager's snapshot save
        // (default order) still runs after the title lands on appState.
        { order: HookOrder.SDK_FIRST - 1 },
      );
    },
  };
}
