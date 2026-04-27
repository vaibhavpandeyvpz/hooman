import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import { BeforeToolCallEvent, type HookCallback } from "@strands-agents/sdk";
import {
  INTERNAL_ALWAYS_ALLOWED,
  allowToolForSession,
  isToolSessionAllowed,
} from "../core/state/tool-approvals.ts";
import { inferToolKind, toolDisplayTitle } from "./utils/tool-kind.ts";
import { toolCallLocationsFromInput } from "./utils/tool-locations.ts";

export function createAcpToolApprovalHook(
  connection: AgentSideConnection,
  sessionId: string,
  /** Tool calls already announced via model stream (`tool_call` pending). */
  streamPrimedToolCallIds?: () => ReadonlySet<string>,
): HookCallback<BeforeToolCallEvent> {
  return async function onBeforeToolCall(event) {
    const name = event.toolUse.name;
    const title = toolDisplayTitle(name, event.tool);
    const kind = inferToolKind(name);
    const locations = toolCallLocationsFromInput(name, event.toolUse.input);

    const primed =
      streamPrimedToolCallIds?.().has(event.toolUse.toolUseId) ?? false;
    if (primed) {
      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: event.toolUse.toolUseId,
          title,
          kind,
          status: "pending",
          rawInput: event.toolUse.input,
          ...(locations ? { locations } : {}),
        },
      });
    } else {
      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: event.toolUse.toolUseId,
          title,
          kind,
          status: "pending",
          rawInput: event.toolUse.input,
          ...(locations ? { locations } : {}),
        },
      });
    }

    if (
      INTERNAL_ALWAYS_ALLOWED.has(name) ||
      isToolSessionAllowed(event.agent, name)
    ) {
      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: event.toolUse.toolUseId,
          status: "in_progress",
        },
      });
      return;
    }

    const response = await connection.requestPermission({
      sessionId,
      toolCall: {
        toolCallId: event.toolUse.toolUseId,
        title,
        kind,
        status: "pending",
        rawInput: event.toolUse.input,
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
    });

    if (response.outcome.outcome === "cancelled") {
      event.cancel = `Tool "${name}" permission request was cancelled.`;
      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: event.toolUse.toolUseId,
          status: "failed",
          rawOutput: { reason: "permission_cancelled" },
        },
      });
      return;
    }

    const optionId = response.outcome.optionId;
    if (optionId === "allow_once") {
      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: event.toolUse.toolUseId,
          status: "in_progress",
        },
      });
      return;
    }
    if (optionId === "allow_always") {
      allowToolForSession(event.agent, name);
      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: event.toolUse.toolUseId,
          status: "in_progress",
        },
      });
      return;
    }
    event.cancel = `Tool "${name}" was rejected by the user.`;
    await connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: event.toolUse.toolUseId,
        status: "failed",
        rawOutput: { reason: "permission_rejected" },
      },
    });
  };
}
