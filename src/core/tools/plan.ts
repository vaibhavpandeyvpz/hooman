import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "@strands-agents/sdk";
import type { JSONValue, ToolContext } from "@strands-agents/sdk";
import { z } from "zod";
import {
  clearPlanModeToDefault,
  getPlanModeState,
  setPlanSessionPlanning,
} from "../state/plan-mode.js";
import { isResolvedPathInsideDir } from "../utils/normalize-user-path.js";
import { plansPath } from "../utils/paths.js";

export const ENTER_PLAN_MODE_TOOL_NAME = "enter_plan_mode";
export const EXIT_PLAN_MODE_TOOL_NAME = "exit_plan_mode";

const PLAN_PREVIEW_MAX_BYTES = 8 * 1024;

const ENTER_STUB_MD = "# Plan\n\n";

const EnterPlanModeInputSchema = z.object({
  reason: z.string().trim().optional(),
});

const ExitPlanModeInputSchema = z.object({});

function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

export function createPlanTools() {
  return [
    tool({
      name: ENTER_PLAN_MODE_TOOL_NAME,
      description: `Use when you should explore and nail down an approach before making substantive edits.
You enter a planning phase and receive one markdown plan document to fill in with your findings, trade-offs, and intended steps.
If you are already in that phase, calling again keeps working with the same document instead of starting over.`,
      inputSchema: EnterPlanModeInputSchema,
      callback: async (
        input: z.infer<typeof EnterPlanModeInputSchema>,
        context?: ToolContext,
      ) => {
        if (!context) {
          throw new Error(
            `${ENTER_PLAN_MODE_TOOL_NAME} requires execution context.`,
          );
        }
        const agent = context.agent;
        const existing = getPlanModeState(agent);
        if (existing.mode === "plan" && existing.planFile) {
          return toJsonValue({
            mode: "plan",
            plan_file: existing.planFile,
            already_active: true,
            enter_reason: existing.enterReason,
            entered_at: existing.enteredAt,
          });
        }

        const dir = plansPath();
        await fs.mkdir(dir, { recursive: true });
        const planFile = path.join(dir, `${randomUUID()}.md`);
        await fs.writeFile(planFile, ENTER_STUB_MD, "utf8");

        if (!isResolvedPathInsideDir(planFile, dir)) {
          throw new Error(
            "Generated plan path is outside the plans directory.",
          );
        }

        const enteredAt = new Date().toISOString();
        setPlanSessionPlanning(agent, {
          planFile,
          enteredAt,
          enterReason: input.reason,
        });

        return toJsonValue({
          mode: "plan",
          plan_file: planFile,
          already_active: false,
          enter_reason: input.reason?.trim() || null,
          entered_at: enteredAt,
        });
      },
    }),
    tool({
      name: EXIT_PLAN_MODE_TOOL_NAME,
      description: `Use when your written plan is ready and you want to leave the planning phase and move toward implementation.
Returns a short excerpt of what you drafted so you can confirm or summarize next actions.
Only call this after you have started planning with enter_plan_mode.`,
      inputSchema: ExitPlanModeInputSchema,
      callback: async (
        _input: z.infer<typeof ExitPlanModeInputSchema>,
        context?: ToolContext,
      ) => {
        if (!context) {
          throw new Error(
            `${EXIT_PLAN_MODE_TOOL_NAME} requires execution context.`,
          );
        }
        const agent = context.agent;
        const state = getPlanModeState(agent);
        if (state.mode !== "plan" || !state.planFile) {
          throw new Error(
            "Not in plan mode; call enter_plan_mode before exit_plan_mode.",
          );
        }

        const planPath = state.planFile;
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

        clearPlanModeToDefault(agent);

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
