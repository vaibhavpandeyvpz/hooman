import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "@strands-agents/sdk";
import type { JSONValue, ToolContext } from "@strands-agents/sdk";
import { z } from "zod";
import {
  clearPlanState,
  getLastPlanFile,
  getPlanState,
  setLastPlanFile,
  setPlanState,
} from "../state/plan.js";
import {
  clearModeToDefault,
  getModeState,
  setSessionMode,
} from "../state/session-mode.js";
import {
  ENTER_PLAN_MODE_TOOL,
  EXIT_PLAN_MODE_TOOL,
} from "../state/tool-approvals.js";
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

const EnterPlanModeInputSchema = z.object({
  reason: z.string().trim().optional(),
  fresh: z
    .boolean()
    .optional()
    .describe(
      "Start a brand-new plan document instead of reopening this session's most recent plan file.",
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

const ExitPlanModeInputSchema = z.object({});

function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

export function createPlanTools() {
  return [
    tool({
      name: ENTER_PLAN_MODE_TOOL,
      description: `Use when you should explore and nail down an approach before making substantive edits.
You enter a planning phase and receive one markdown plan document to fill in with your findings, trade-offs, and intended steps.
If you are already in that phase, calling again keeps working with the same document instead of starting over.
Re-entering after leaving reopens this session's most recent plan file so you can keep refining it; pass fresh: true to start over.`,
      inputSchema: EnterPlanModeInputSchema,
      callback: async (
        input: z.infer<typeof EnterPlanModeInputSchema>,
        context?: ToolContext,
      ) => {
        if (!context) {
          throw new Error(
            `${ENTER_PLAN_MODE_TOOL} requires execution context.`,
          );
        }
        const agent = context.agent;
        const { mode } = getModeState(agent);
        if (!["agent", "plan"].includes(mode)) {
          throw new Error(
            `enter_plan_mode is not available in ${mode} session mode. Switch to agent or plan mode first.`,
          );
        }
        const plan = getPlanState(agent);
        if (mode === "plan" && plan.planFile) {
          return toJsonValue({
            mode: "plan",
            plan_file: plan.planFile,
            already_active: true,
            enter_reason: plan.enterReason,
            entered_at: plan.enteredAt,
          });
        }

        const dir = plansPath();
        await fs.mkdir(dir, { recursive: true });

        const lastPlanFile = getLastPlanFile(agent);
        const reusable =
          !input.fresh &&
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
          throw new Error(
            "Generated plan path is outside the plans directory.",
          );
        }

        const enteredAt = new Date().toISOString();
        setSessionMode(agent, "plan");
        setPlanState(agent, {
          planFile,
          enteredAt,
          enterReason: input.reason,
        });
        setLastPlanFile(agent, planFile);

        return toJsonValue({
          mode: "plan",
          plan_file: planFile,
          already_active: false,
          reused,
          enter_reason: input.reason?.trim() || null,
          entered_at: enteredAt,
        });
      },
    }),
    tool({
      name: EXIT_PLAN_MODE_TOOL,
      description: `Use when your written plan is ready and you want to leave the planning phase and move toward implementation.
This is a proposal: the user is asked to approve it. If they decline, you stay in planning mode with the same plan file and should keep refining it based on their feedback.
Returns a short excerpt of what you drafted so you can confirm or summarize next actions.
Only call this after you have started planning with enter_plan_mode.`,
      inputSchema: ExitPlanModeInputSchema,
      callback: async (
        _input: z.infer<typeof ExitPlanModeInputSchema>,
        context?: ToolContext,
      ) => {
        if (!context) {
          throw new Error(`${EXIT_PLAN_MODE_TOOL} requires execution context.`);
        }
        const agent = context.agent;
        const { mode } = getModeState(agent);
        const plan = getPlanState(agent);
        if (mode !== "plan" || !plan.planFile) {
          throw new Error(
            "Not in plan mode; call enter_plan_mode before exit_plan_mode.",
          );
        }

        const planPath = plan.planFile;
        let preview = "";
        let truncated = false;
        try {
          const buf = await fs.readFile(planPath);
          truncated = buf.length > PLAN_PREVIEW_MAX_BYTES;
          const slice = buf.subarray(
            0,
            Math.min(PLAN_PREVIEW_MAX_BYTES, buf.length),
          );
          preview = slice.toString("utf8");
        } catch (error) {
          throw new Error(
            `Could not read plan file: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        setLastPlanFile(agent, planPath);
        clearModeToDefault(agent);
        clearPlanState(agent);

        return toJsonValue({
          exited: true,
          plan_file: planPath,
          preview,
          truncated,
        });
      },
    }),
  ];
}
