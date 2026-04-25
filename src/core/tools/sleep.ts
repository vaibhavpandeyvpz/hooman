import { setTimeout as sleepTimer } from "node:timers/promises";
import { tool } from "@strands-agents/sdk";
import type { JSONValue, ToolContext } from "@strands-agents/sdk";
import { z } from "zod";

const MAX_SLEEP_SECONDS = 60 * 60;

function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

export function createSleepTools() {
  return [
    tool({
      name: "sleep",
      description:
        "Wait for a specified number of seconds without using shell processes. Use when the user asks you to pause or retry after a delay.",
      inputSchema: z.object({
        seconds: z.coerce
          .number()
          .positive()
          .max(MAX_SLEEP_SECONDS)
          .describe(
            `How long to wait, in seconds. Must be greater than 0 and at most ${MAX_SLEEP_SECONDS}.`,
          ),
      }),
      callback: async (input, context?: ToolContext) => {
        const startedAt = Date.now();
        try {
          await sleepTimer(input.seconds * 1000, undefined, {
            signal: context?.agent.cancelSignal,
          });
          return toJsonValue({
            status: "completed",
            requested_seconds: input.seconds,
            slept_seconds: (Date.now() - startedAt) / 1000,
          });
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            return toJsonValue({
              status: "cancelled",
              requested_seconds: input.seconds,
              slept_seconds: (Date.now() - startedAt) / 1000,
            });
          }
          throw error;
        }
      },
    }),
  ];
}
