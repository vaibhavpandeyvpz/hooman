import {
  methods,
  RequestError,
  type AgentContext,
  type PermissionOption,
} from "@agentclientprotocol/sdk";
import type {
  AskUserBackend,
  AskUserResponse,
} from "../core/tools/ask-user.js";

/**
 * `_meta` key set on `session/request_permission` requests that carry an
 * `ask_user` question rather than a tool approval. First-party clients (the
 * VS Code extension) use it to render a question card instead of the
 * shield-style permission card; other ACP clients ignore it and still work,
 * since the answers are plain permission options.
 */
export const ACP_ASK_USER_META_KEY = "hoomanjs/ask_user";

const DISMISS_OPTION_ID = "dismiss";

/** JSON-RPC "Request Cancelled" (-32800), sent when a request is cancelled. */
const REQUEST_CANCELLED_CODE = -32800;

function isRequestCancelled(error: unknown): boolean {
  return error instanceof RequestError && error.code === REQUEST_CANCELLED_CODE;
}

/**
 * `ask_user` backend for ACP sessions: presents the question as a
 * `session/request_permission` prompt whose options are the answer choices
 * (plus a Dismiss option). This reuses the one interactive primitive every
 * ACP client already implements, so questions work in Zed, the VS Code
 * extension, and any other conforming client without protocol extensions.
 */
export function createAcpAskUserBackend(
  client: AgentContext,
  sessionId: string,
): AskUserBackend {
  return {
    ask: async (request): Promise<AskUserResponse> => {
      const options: PermissionOption[] = [
        ...request.options.map((option, index) => ({
          kind: "allow_once" as const,
          name: option,
          optionId: `answer_${index}`,
        })),
        {
          kind: "reject_once" as const,
          name: "Dismiss",
          optionId: DISMISS_OPTION_ID,
        },
      ];

      let response;
      try {
        response = await client.request(
          methods.client.session.requestPermission,
          {
            sessionId,
            toolCall: {
              // Reuse the ask_user tool call id so clients anchor the prompt
              // to the already-announced tool card.
              toolCallId: request.toolUseId ?? crypto.randomUUID(),
              title: request.question,
              kind: "other",
              status: "in_progress",
              rawInput: {
                question: request.question,
                options: request.options,
              },
            },
            options,
            _meta: { [ACP_ASK_USER_META_KEY]: true },
          },
          request.signal ? { cancellationSignal: request.signal } : {},
        );
      } catch (error) {
        if (request.signal?.aborted || isRequestCancelled(error)) {
          return { kind: "dismissed" };
        }
        throw error;
      }

      if (response.outcome.outcome === "cancelled") {
        return { kind: "dismissed" };
      }
      const optionId = response.outcome.optionId;
      if (optionId === DISMISS_OPTION_ID) {
        return { kind: "dismissed" };
      }
      const index = Number.parseInt(
        String(optionId).replace("answer_", ""),
        10,
      );
      const answer = request.options[index];
      if (answer === undefined) {
        return { kind: "dismissed" };
      }
      return { kind: "answered", answer };
    },
  };
}
