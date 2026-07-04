import { tool } from "@strands-agents/sdk";
import type { JSONValue, ToolContext } from "@strands-agents/sdk";
import { z } from "zod";

export const ASK_USER_TOOL_NAME = "ask_user";

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 5;

/**
 * Optional per-agent ask-user backend.
 *
 * When a frontend has an interactive human available (chat TUI, exec with a
 * TTY, an ACP client), it registers a backend here and the `ask_user` tool
 * routes questions through it, blocking the tool call until the user answers
 * or dismisses. When no backend is registered (daemon mode, non-interactive
 * exec, subagents), the tool reports that no user is available so the model
 * can proceed autonomously.
 */
export type AskUserRequest = {
  /** The question to present to the user. */
  question: string;
  /** 2–5 answer choices, in display order. */
  options: string[];
  /** Tool-use id of the `ask_user` call, for frontends that key UI on it. */
  toolUseId?: string;
  /** Turn cancel signal; backends should resolve as dismissed on abort. */
  signal?: AbortSignal;
};

export type AskUserResponse =
  | {
      kind: "answered";
      /** One of {@link AskUserRequest.options} or free text typed by the user. */
      answer: string;
    }
  | { kind: "dismissed" };

export type AskUserBackend = {
  ask(request: AskUserRequest): Promise<AskUserResponse>;
};

/** Keyed by the Strands agent instance so backends are never serialized. */
const backends = new WeakMap<object, AskUserBackend>();

export function setAskUserBackend(
  agent: object,
  backend: AskUserBackend,
): void {
  backends.set(agent, backend);
}

export function getAskUserBackend(
  agent: object | undefined,
): AskUserBackend | undefined {
  return agent ? backends.get(agent) : undefined;
}

function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

export function createAskUserTools() {
  return [
    tool({
      name: ASK_USER_TOOL_NAME,
      description:
        "Ask the user one multiple-choice question and wait for their answer. Only for decisions that are genuinely the user's to make; the user may pick an option, type a free-form answer, or dismiss.",
      inputSchema: z.object({
        question: z
          .string()
          .min(1)
          .describe(
            "The question to present to the user. Keep it short and specific.",
          ),
        options: z
          .array(z.string().min(1))
          .min(MIN_OPTIONS)
          .max(MAX_OPTIONS)
          .describe(
            `Between ${MIN_OPTIONS} and ${MAX_OPTIONS} short answer choices, recommended option first.`,
          ),
      }),
      callback: async (input, context?: ToolContext) => {
        const backend = getAskUserBackend(context?.agent);
        if (!backend) {
          return toJsonValue({
            status: "no_user_available",
            message:
              "No interactive user is available to answer questions in this environment. Proceed with your best judgement and state the assumption you made.",
          });
        }
        const response = await backend.ask({
          question: input.question,
          options: input.options,
          toolUseId: context?.toolUse.toolUseId,
          signal: context?.agent.cancelSignal,
        });
        if (response.kind === "dismissed") {
          return toJsonValue({
            status: "dismissed",
            message:
              "The user dismissed the question without answering. Proceed with your best judgement, or continue with the parts of the task that do not depend on the answer.",
          });
        }
        return toJsonValue({
          status: "answered",
          question: input.question,
          answer: response.answer,
        });
      },
    }),
  ];
}
