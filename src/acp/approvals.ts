import {
  type AgentContext,
  type SessionNotification,
  methods,
} from "@agentclientprotocol/sdk";
import { HoomanToolApprovalIntervention } from "../core/approvals/intervention.js";
import { inferToolKind, toolDisplayTitle } from "./utils/tool-kind.js";
import { toolCallLocationsFromInput } from "./utils/tool-locations.js";

export function createAcpToolApprovalIntervention(
  client: AgentContext,
  sessionId: string,
  /** Tool calls already announced via model stream (`tool_call` pending). */
  streamPrimedToolCallIds?: () => ReadonlySet<string>,
) {
  const sendUpdate = (update: SessionNotification["update"]) =>
    client.notify(methods.client.session.update, { sessionId, update });

  async function sendPending(
    request: {
      toolName: string;
      input: unknown;
      description?: string;
    },
    toolUseId: string,
  ) {
    const desc = request.description?.trim();
    const title =
      desc && desc.length <= 120
        ? `${request.toolName}: ${desc}`
        : request.toolName;
    const kind = inferToolKind(request.toolName);
    const locations = toolCallLocationsFromInput(
      request.toolName,
      request.input,
    );
    const primed = streamPrimedToolCallIds?.().has(toolUseId) ?? false;

    await sendUpdate({
      sessionUpdate: primed ? "tool_call_update" : "tool_call",
      toolCallId: toolUseId,
      title,
      kind,
      status: "pending",
      rawInput: request.input,
      ...(locations ? { locations } : {}),
    });
  }

  return new HoomanToolApprovalIntervention({
    onPromptStart: async (request, event) => {
      await sendPending(request, event.toolUse.toolUseId);
    },
    onApproved: async (request, event, decision) => {
      if (decision === "auto") {
        await sendPending(request, event.toolUse.toolUseId);
      }
      await sendUpdate({
        sessionUpdate: "tool_call_update",
        toolCallId: event.toolUse.toolUseId,
        status: "in_progress",
      });
    },
    onRejected: async (_request, event, reason) => {
      await sendUpdate({
        sessionUpdate: "tool_call_update",
        toolCallId: event.toolUse.toolUseId,
        status: "failed",
        rawOutput: { reason: "permission_rejected", message: reason },
      });
    },
    ask: async (request, event) => {
      const title = toolDisplayTitle(request.toolName, event.tool);
      const kind = inferToolKind(request.toolName);
      const locations = toolCallLocationsFromInput(
        request.toolName,
        request.input,
      );

      const response = await client.request(
        methods.client.session.requestPermission,
        {
          sessionId,
          toolCall: {
            toolCallId: event.toolUse.toolUseId,
            title,
            kind,
            status: "pending",
            rawInput: request.input,
            ...(locations ? { locations } : {}),
          },
          options: [
            {
              kind: "allow_once",
              name: "Allow once",
              optionId: "allow_once",
            },
            {
              kind: "allow_always",
              name: "Always allow",
              optionId: "allow_always",
            },
            {
              kind: "reject_once",
              name: "Reject",
              optionId: "reject_once",
            },
          ],
        },
      );

      if (response.outcome.outcome === "cancelled") {
        return {
          decision: "reject",
          reason: `Tool "${request.toolName}" permission request was cancelled.`,
        };
      }

      if (response.outcome.optionId === "allow_once") {
        return "allow";
      }
      if (response.outcome.optionId === "allow_always") {
        return "always";
      }
      return "reject";
    },
  });
}
