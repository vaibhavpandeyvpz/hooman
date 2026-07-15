import {
  InterventionHandler,
  InterventionActions,
  type BeforeToolCallEvent,
} from "@strands-agents/sdk";
import fs from "node:fs/promises";
import { getModeDefinition } from "../modes/definitions.js";
import { getPlanState } from "../state/plan.js";
import { getModeState } from "../state/session-mode.js";
import {
  INTERNAL_ALWAYS_ALLOWED,
  isImplicitlyAllowed,
  planModeWriteEditRejectionMessage,
  SWITCH_MODE_TOOL,
} from "../state/tool-approvals.js";
import { isYoloEnabled } from "../state/yolo.js";
import { getAllowlist } from "./allowlist.js";

const INPUT_PREVIEW_LIMIT = 1_024;
const PLAN_PREVIEW_MAX_BYTES = 8 * 1024;

export type ToolApprovalDecision = "allow" | "always";

export type ToolApprovalResult =
  ToolApprovalDecision | "reject" | { decision: "reject"; reason?: string };

export type SwitchModeApprovalAction = "switch" | "start_fresh_plan";

export type ToolApprovalRequest = {
  toolName: string;
  description?: string;
  input: unknown;
  inputPreview: string;
  prompt: string;
  /**
   * Human-facing preview of the artifact being acted on (e.g. the drafted plan
   * when leaving plan via {@link SWITCH_MODE_TOOL}). Frontends may render this
   * above the approve/decline choices.
   */
  preview?: string;
  /** Current session mode id when approving {@link SWITCH_MODE_TOOL}. */
  currentMode?: string;
  /** Target mode id from {@link SWITCH_MODE_TOOL} input. */
  targetMode?: string;
  /** Human-visible operation represented by this switch request. */
  switchModeAction?: SwitchModeApprovalAction;
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

/** Display name for a session mode id (falls back to the raw id). */
export function modeDisplayName(modeId: string): string {
  return getModeDefinition(modeId)?.name ?? modeId;
}

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

function isPlainObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function switchModeTarget(toolInput: unknown): string | undefined {
  if (!isPlainObjectRecord(toolInput)) {
    return undefined;
  }
  const next = toolInput.mode;
  return typeof next === "string" && next.trim() ? next.trim() : undefined;
}

function requestsFreshPlan(toolInput: unknown): boolean {
  return isPlainObjectRecord(toolInput) && toolInput.fresh === true;
}

/** True when {@link SWITCH_MODE_TOOL} is leaving plan for another mode. */
export function isLeavingPlanMode(
  toolName: string,
  toolInput: unknown,
  currentMode: string,
): boolean {
  if (toolName !== SWITCH_MODE_TOOL || currentMode !== "plan") {
    return false;
  }
  const next = switchModeTarget(toolInput);
  return typeof next === "string" && next !== "plan";
}

async function readPlanPreview(
  agent: BeforeToolCallEvent["agent"],
): Promise<string | null> {
  const { planFile } = getPlanState(agent);
  if (!planFile) {
    return null;
  }
  try {
    const buf = await fs.readFile(planFile);
    const slice = buf.subarray(0, Math.min(PLAN_PREVIEW_MAX_BYTES, buf.length));
    const text = slice.toString("utf8").trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
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
    let request = this.buildRequest(event);
    const currentMode = getModeState(event.agent).mode;
    // Every switch_mode call (enter plan, leave plan, ask↔agent, etc.) must
    // prompt — never skip via yolo, INTERNAL_ALWAYS_ALLOWED, implicit paths,
    // or a persisted allowlist entry.
    const isSwitchMode = toolName === SWITCH_MODE_TOOL;
    const leavingPlan = isLeavingPlanMode(
      toolName,
      event.toolUse.input,
      currentMode,
    );
    if (isSwitchMode) {
      const targetMode = switchModeTarget(event.toolUse.input);
      const startsFreshPlan =
        currentMode === "plan" &&
        targetMode === "plan" &&
        requestsFreshPlan(event.toolUse.input);
      request = {
        ...request,
        currentMode,
        ...(targetMode ? { targetMode } : {}),
        switchModeAction: startsFreshPlan ? "start_fresh_plan" : "switch",
      };

      const missingPlanDocument =
        currentMode === "plan" &&
        targetMode === "plan" &&
        !getPlanState(event.agent).planFile;
      if (
        targetMode === currentMode &&
        !startsFreshPlan &&
        !missingPlanDocument
      ) {
        await this.onApproved?.(request, event, "auto");
        return InterventionActions.proceed();
      }
    }

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
      !isSwitchMode &&
      (isYoloEnabled(event.agent) ||
        INTERNAL_ALWAYS_ALLOWED.has(toolName) ||
        isImplicitlyAllowed(toolName, event.toolUse.input, currentMode) ||
        getAllowlist().isAllowed(toolName, event.toolUse.input))
    ) {
      await this.onApproved?.(request, event, "auto");
      return InterventionActions.proceed();
    }

    if (leavingPlan) {
      const preview = await readPlanPreview(event.agent);
      if (preview) {
        request = { ...request, preview };
      }
    }

    await this.onPromptStart?.(request, event);
    const result = await this.ask(request, event);
    if (result === "allow") {
      await this.onApproved?.(request, event, "allow");
      return InterventionActions.proceed();
    }
    if (result === "always") {
      // switch_mode must never persist "always allow" — treat as one-shot allow.
      if (isSwitchMode) {
        await this.onApproved?.(request, event, "allow");
        return InterventionActions.proceed();
      }
      getAllowlist().allowAlways(toolName, event.toolUse.input);
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
