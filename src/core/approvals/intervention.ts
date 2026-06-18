import {
  InterventionHandler,
  InterventionActions,
  type BeforeToolCallEvent,
  type JSONValue,
} from "@strands-agents/sdk";
import {
  INTERNAL_ALWAYS_ALLOWED,
  allowToolForSession,
  isToolSessionAllowed,
  planModeWriteEditRejectionMessage,
} from "../state/tool-approvals.js";
import { isYoloEnabled } from "../state/yolo.js";

const INPUT_PREVIEW_LIMIT = 1_024;

export type ToolApprovalDecision = "allow" | "always";

export type ToolApprovalResult =
  | ToolApprovalDecision
  | "reject"
  | { decision: "reject"; reason?: string };

export type ToolApprovalRequest = {
  toolName: string;
  description?: string;
  input: unknown;
  inputPreview: string;
  prompt: string;
};

type ToolApprovalCallbacks = {
  onPromptStart?: (
    request: ToolApprovalRequest,
    event: BeforeToolCallEvent,
  ) => Promise<void> | void;
  onApproved?: (
    request: ToolApprovalRequest,
    event: BeforeToolCallEvent,
    decision: ToolApprovalDecision | "auto",
  ) => Promise<void> | void;
  onRejected?: (
    request: ToolApprovalRequest,
    event: BeforeToolCallEvent,
    reason: string,
  ) => Promise<void> | void;
};

export type ToolApprovalAsk = (
  request: ToolApprovalRequest,
  event: BeforeToolCallEvent,
) => Promise<ToolApprovalResult>;

export type HoomanToolApprovalInterventionConfig = ToolApprovalCallbacks & {
  ask: ToolApprovalAsk;
};

function previewInput(input: unknown): string {
  try {
    const text = JSON.stringify(input, null, 2) ?? "null";
    return text.length > INPUT_PREVIEW_LIMIT
      ? `${text.slice(0, INPUT_PREVIEW_LIMIT)}\n... (truncated)`
      : text;
  } catch {
    return String(input);
  }
}

function toRejectReason(toolName: string, result: ToolApprovalResult): string {
  if (typeof result === "object" && result !== null && result.reason?.trim()) {
    return result.reason.trim();
  }
  return `Tool "${toolName}" was rejected by the user.`;
}

export class HoomanToolApprovalIntervention extends InterventionHandler {
  public readonly name = "hooman:tool-approval";

  private readonly ask: ToolApprovalAsk;
  private readonly onPromptStart?: ToolApprovalCallbacks["onPromptStart"];
  private readonly onApproved?: ToolApprovalCallbacks["onApproved"];
  private readonly onRejected?: ToolApprovalCallbacks["onRejected"];

  public constructor(config: HoomanToolApprovalInterventionConfig) {
    super();
    this.ask = config.ask;
    this.onPromptStart = config.onPromptStart;
    this.onApproved = config.onApproved;
    this.onRejected = config.onRejected;
  }

  public override async beforeToolCall(
    event: BeforeToolCallEvent,
  ): Promise<
    | ReturnType<typeof InterventionActions.proceed>
    | ReturnType<typeof InterventionActions.deny>
  > {
    const toolName = event.toolUse.name;
    const request = this.buildRequest(event);

    const planReject = planModeWriteEditRejectionMessage(
      event.agent,
      toolName,
      event.toolUse.input,
    );
    if (planReject) {
      await this.onRejected?.(request, event, planReject);
      return InterventionActions.deny(planReject);
    }

    if (
      isYoloEnabled(event.agent) ||
      INTERNAL_ALWAYS_ALLOWED.has(toolName) ||
      isToolSessionAllowed(event.agent, toolName, event.toolUse.input)
    ) {
      await this.onApproved?.(request, event, "auto");
      return InterventionActions.proceed();
    }

    await this.onPromptStart?.(request, event);
    const result = await this.ask(request, event);
    if (result === "allow") {
      await this.onApproved?.(request, event, "allow");
      return InterventionActions.proceed();
    }
    if (result === "always") {
      allowToolForSession(event.agent, toolName);
      await this.onApproved?.(request, event, "always");
      return InterventionActions.proceed();
    }

    const reason = toRejectReason(toolName, result);
    await this.onRejected?.(request, event, reason);
    return InterventionActions.deny(reason);
  }

  private buildRequest(event: BeforeToolCallEvent): ToolApprovalRequest {
    const toolName = event.toolUse.name;
    const description = event.tool?.description?.trim();
    const inputPreview = previewInput(event.toolUse.input);
    return {
      toolName,
      description,
      input: event.toolUse.input,
      inputPreview,
      prompt: `Tool "${toolName}" requires human approval. Input: ${inputPreview}`,
    };
  }
}

export function normalizeApprovalResponse(response: JSONValue): ToolApprovalResult {
  if (response === true) {
    return "allow";
  }
  if (typeof response === "string") {
    const normalized = response.trim().toLowerCase();
    if (normalized === "y" || normalized === "yes" || normalized === "allow") {
      return "allow";
    }
    if (
      normalized === "t" ||
      normalized === "trust" ||
      normalized === "always"
    ) {
      return "always";
    }
  }
  return "reject";
}
