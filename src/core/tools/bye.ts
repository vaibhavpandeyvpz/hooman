import { tool } from "@strands-agents/sdk";
import type { ToolContext } from "@strands-agents/sdk";
import { z } from "zod";
import { EXIT_REQUESTED_CODE, requestExit } from "../state/exit-request.js";

export function createByeTools() {
  return [
    tool({
      name: "bye",
      description:
        "Request a graceful exit of the current agent process after this turn completes. Only call this when the user explicitly asks to exit, close, quit, say goodbye, or restart the agent.",
      inputSchema: z.object({}),
      callback: async (_input, context?: ToolContext) => {
        if (!context) {
          throw new Error("The bye tool requires agent context.");
        }
        requestExit(context.agent);
        return {
          status: "exit_requested",
          exit_code: EXIT_REQUESTED_CODE,
        };
      },
    }),
  ];
}
