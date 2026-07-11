import {
  type AgentContext,
  type PermissionOption,
  type SessionNotification,
  methods,
  RequestError,
} from "@agentclientprotocol/sdk";
import {
  HoomanToolApprovalIntervention,
  modeDisplayName,
} from "../core/approvals/intervention.js";
import { SWITCH_MODE_TOOL } from "../core/state/tool-approvals.js";
import { inferToolKind, toolDisplayTitle } from "./utils/tool-kind.js";
import { toolCallLocationsFromInput } from "./utils/tool-locations.js";

/** JSON-RPC "Request Cancelled" (-32800), sent when a request is cancelled. */
const REQUEST_CANCELLED_CODE = -32800;

function isRequestCancelled(error: unknown): boolean {
  return error instanceof RequestError && error.code === REQUEST_CANCELLED_CODE;
}

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
      // Tie the permission prompt to the turn's cancel signal so `session/cancel`
      // cascades a `$/cancel_request` to the client instead of hanging.
      const cancellationSignal = event.agent.cancelSignal;
      const cancelledReason = `Tool "${request.toolName}" permission request was cancelled.`;

      const isSwitchMode = request.toolName === SWITCH_MODE_TOOL;
      const currentName = modeDisplayName(request.currentMode ?? "agent");
      const targetName = modeDisplayName(request.targetMode ?? "agent");

      // switch_mode: no "always allow". Other tools keep the usual trio.
      const options: PermissionOption[] = isSwitchMode
        ? [
            {
              kind: "allow_once" as const,
              name: `Switch to ${targetName} mode`,
              optionId: "allow_once",
            },
            {
              kind: "reject_once" as const,
              name: `Stay in ${currentName} mode`,
              optionId: "reject_once",
            },
          ]
        : [
            {
              kind: "allow_once" as const,
              name: "Allow once",
              optionId: "allow_once",
            },
            {
              kind: "allow_always" as const,
              name: "Always allow",
              optionId: "allow_always",
            },
            {
              kind: "reject_once" as const,
              name: "Reject",
              optionId: "reject_once",
            },
          ];

      let response;
      try {
        response = await client.request(
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
            options,
          },
          { cancellationSignal },
        );
      } catch (error) {
        if (cancellationSignal.aborted || isRequestCancelled(error)) {
          return { decision: "reject", reason: cancelledReason };
        }
        throw error;
      }

      if (response.outcome.outcome === "cancelled") {
        return { decision: "reject", reason: cancelledReason };
      }

      if (response.outcome.optionId === "allow_once") {
        return "allow";
      }
      if (response.outcome.optionId === "allow_always") {
        return "always";
      }
      if (isSwitchMode) {
        return {
          decision: "reject",
          reason: `User chose to stay in ${currentName} mode.`,
        };
      }
      return "reject";
    },
  });
}
