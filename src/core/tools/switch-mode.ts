import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "@strands-agents/sdk";
import type { JSONValue, ToolContext } from "@strands-agents/sdk";
import { z } from "zod";
import { formatModeNames } from "../modes/definitions.js";
import {
  isKnownSessionMode,
  MODE_IDS,
  type KnownSessionMode,
} from "../modes/schema.js";
import {
  clearPlanState,
  getLastPlanFile,
  getPlanState,
  setLastPlanFile,
  setPlanState,
} from "../state/plan.js";
import { getModeState, setSessionMode } from "../state/session-mode.js";
import { SWITCH_MODE_TOOL } from "../state/tool-approvals.js";
import { isResolvedPathInsideDir } from "../utils/normalize-user-path.js";
import { plansPath } from "../utils/paths.js";

const PLAN_PREVIEW_MAX_BYTES = 8 * 1024;

const ENTER_STUB_MD = `---
name: Plan
overview: ""
tasks: []
status: pending
---

# Plan
`;

const SwitchModeInputSchema = z.object({
  mode: z
    .enum(MODE_IDS)
    .describe(`Session mode to switch to (${formatModeNames()}).`),
  reason: z
    .string()
    .trim()
    .optional()
    .describe("Why this mode switch is being requested."),
  fresh: z
    .boolean()
    .optional()
    .describe(
      "When switching to plan: start a brand-new plan document instead of reopening this session's most recent plan file.",
    ),
});

async function fileExists(target: string): Promise<boolean> {
  try {
    const stat = await fs.stat(target);
    return stat.isFile();
  } catch {
    return false;
  }
}

function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

async function ensurePlanDocument(
  agent: ToolContext["agent"],
  options: { reason?: string; fresh?: boolean },
): Promise<{
  planFile: string;
  alreadyActive: boolean;
  reused: boolean;
  enteredAt: string;
  enterReason: string | null;
}> {
  const plan = getPlanState(agent);
  const { mode } = getModeState(agent);
  if (mode === "plan" && plan.planFile) {
    return {
      planFile: plan.planFile,
      alreadyActive: true,
      reused: true,
      enteredAt: plan.enteredAt ?? new Date().toISOString(),
      enterReason: plan.enterReason,
    };
  }

  const dir = plansPath();
  await fs.mkdir(dir, { recursive: true });

  const lastPlanFile = getLastPlanFile(agent);
  const reusable =
    !options.fresh &&
    lastPlanFile &&
    isResolvedPathInsideDir(lastPlanFile, dir) &&
    (await fileExists(lastPlanFile));

  let planFile: string;
  let reused: boolean;
  if (reusable && lastPlanFile) {
    planFile = lastPlanFile;
    reused = true;
  } else {
    planFile = path.join(dir, `${randomUUID()}.plan.md`);
    await fs.writeFile(planFile, ENTER_STUB_MD, "utf8");
    reused = false;
  }

  if (!isResolvedPathInsideDir(planFile, dir)) {
    throw new Error("Generated plan path is outside the plans directory.");
  }

  const enteredAt = new Date().toISOString();
  setPlanState(agent, {
    planFile,
    enteredAt,
    enterReason: options.reason,
  });
  setLastPlanFile(agent, planFile);

  return {
    planFile,
    alreadyActive: false,
    reused,
    enteredAt,
    enterReason: options.reason?.trim() || null,
  };
}

async function leavePlanMode(
  agent: ToolContext["agent"],
): Promise<{ planFile: string; preview: string; truncated: boolean } | null> {
  const plan = getPlanState(agent);
  if (!plan.planFile) {
    clearPlanState(agent);
    return null;
  }

  const planPath = plan.planFile;
  let preview = "";
  let truncated = false;
  try {
    const buf = await fs.readFile(planPath);
    truncated = buf.length > PLAN_PREVIEW_MAX_BYTES;
    const slice = buf.subarray(0, Math.min(PLAN_PREVIEW_MAX_BYTES, buf.length));
    preview = slice.toString("utf8");
  } catch (error) {
    throw new Error(
      `Could not read plan file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  setLastPlanFile(agent, planPath);
  clearPlanState(agent);
  return { planFile: planPath, preview, truncated };
}

export function createSwitchModeTool() {
  return tool({
    name: SWITCH_MODE_TOOL,
    description: `Propose switching the session mode to one of: ${formatModeNames()}.
This always requires explicit user approval via the permission UI (never auto-approved, never "always allow").
Do not ask the user in chat to approve — the permission card is the approval. When this tool returns successfully, continue immediately in the new mode.
Switching to plan opens or reopens a markdown plan document for findings, trade-offs, and intended steps.
Leaving plan is a proposal to start implementing — if declined, you stay in plan mode with the same plan file.
Pass fresh: true when entering plan to start a new document instead of reopening the session's last plan.`,
    inputSchema: SwitchModeInputSchema,
    callback: async (
      input: z.infer<typeof SwitchModeInputSchema>,
      context?: ToolContext,
    ) => {
      if (!context) {
        throw new Error(`${SWITCH_MODE_TOOL} requires execution context.`);
      }
      if (!isKnownSessionMode(input.mode)) {
        throw new Error(
          `Unknown mode "${input.mode}". Use one of: ${formatModeNames()}.`,
        );
      }

      const agent = context.agent;
      const previousMode = getModeState(agent).mode;
      const nextMode = input.mode as KnownSessionMode;

      if (previousMode === nextMode && nextMode !== "plan") {
        return toJsonValue({
          status: "ok",
          mode: nextMode,
          previous_mode: previousMode,
          already_active: true,
          reason: input.reason?.trim() || null,
          hint: `Already in ${nextMode} mode. Continue with the task; do not ask the user to approve a mode switch.`,
        });
      }

      let plan: Awaited<ReturnType<typeof ensurePlanDocument>> | null = null;
      let leftPlan: Awaited<ReturnType<typeof leavePlanMode>> | null = null;

      if (previousMode === "plan" && nextMode !== "plan") {
        leftPlan = await leavePlanMode(agent);
      }

      if (nextMode === "plan") {
        plan = await ensurePlanDocument(agent, {
          reason: input.reason,
          fresh: input.fresh,
        });
      }

      setSessionMode(agent, nextMode);

      return toJsonValue({
        status: "ok",
        mode: nextMode,
        previous_mode: previousMode,
        already_active: plan?.alreadyActive === true,
        reason: input.reason?.trim() || null,
        hint: `Mode switch approved and applied (${previousMode} → ${nextMode}). Continue with the task.`,
        ...(plan
          ? {
              plan_file: plan.planFile,
              reused: plan.reused,
              enter_reason: plan.enterReason,
              entered_at: plan.enteredAt,
            }
          : {}),
        ...(leftPlan
          ? {
              exited_plan: true,
              plan_file: leftPlan.planFile,
              preview: leftPlan.preview,
              truncated: leftPlan.truncated,
            }
          : {}),
      });
    },
  });
}
