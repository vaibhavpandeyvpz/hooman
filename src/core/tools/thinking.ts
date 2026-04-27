import { tool } from "@strands-agents/sdk";
import type { JSONValue, ToolContext } from "@strands-agents/sdk";
import { z } from "zod";
import {
  readThinkingState,
  type ThoughtEntry,
  writeThinkingState,
} from "../state/thought-process.ts";

const coercedBoolean = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return value;
}, z.boolean());

function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function normalizeThought(
  input: z.infer<ReturnType<typeof createThinkingInputSchema>>,
): ThoughtEntry {
  if (input.isRevision && input.revisesThought == null) {
    throw new Error("`revisesThought` is required when `isRevision` is true.");
  }

  if (input.branchFromThought != null && !input.branchId) {
    throw new Error(
      "`branchId` is required when `branchFromThought` is provided.",
    );
  }

  const totalThoughts =
    input.needsMoreThoughts || input.thoughtNumber > input.totalThoughts
      ? Math.max(input.totalThoughts, input.thoughtNumber + 1)
      : input.totalThoughts;

  return {
    thought: input.thought.trim(),
    thoughtNumber: input.thoughtNumber,
    totalThoughts,
    nextThoughtNeeded: input.nextThoughtNeeded,
    isRevision: input.isRevision ?? false,
    revisesThought: input.revisesThought ?? null,
    branchFromThought: input.branchFromThought ?? null,
    branchId: input.branchId ?? null,
    needsMoreThoughts: input.needsMoreThoughts ?? false,
  };
}

function createThinkingInputSchema() {
  return z.object({
    thought: z.string().min(1).describe("Your current thinking step."),
    nextThoughtNeeded: coercedBoolean.describe(
      "Whether another thought step is needed.",
    ),
    thoughtNumber: z.coerce
      .number()
      .int()
      .min(1)
      .describe("Current thought number."),
    totalThoughts: z.coerce
      .number()
      .int()
      .min(1)
      .describe("Current estimate of total thoughts needed."),
    isRevision: coercedBoolean
      .optional()
      .describe("Whether this thought revises previous thinking."),
    revisesThought: z.coerce
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Which prior thought is being reconsidered."),
    branchFromThought: z.coerce
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Thought number this branch diverges from."),
    branchId: z
      .string()
      .optional()
      .describe("Identifier for the current branch."),
    needsMoreThoughts: coercedBoolean
      .optional()
      .describe(
        "Whether more thoughts are needed beyond the current estimate.",
      ),
  });
}

export function createThinkingTools() {
  const inputSchema = createThinkingInputSchema();

  return [
    tool({
      name: "think",
      description: `A sequential thinking tool for dynamic, reflective problem-solving.
Use it to break complex work into steps, revise earlier thinking, branch into alternatives,
and keep track of whether more analysis is still needed. Prefer this for planning,
debugging, design exploration, or other multi-step reasoning tasks.`,
      inputSchema,
      callback: async (input, context?: ToolContext) => {
        if (!context) {
          throw new Error("Think tool requires execution context.");
        }

        const state = readThinkingState(context);

        if (input.thoughtNumber === 1 && !input.isRevision) {
          state.history = [];
          state.branches = [];
        }

        const normalized = normalizeThought(input);

        if (
          normalized.branchId &&
          !state.branches.includes(normalized.branchId)
        ) {
          state.branches.push(normalized.branchId);
        }

        state.history.push(normalized);
        writeThinkingState(context, state);

        return toJsonValue({
          thoughtNumber: normalized.thoughtNumber,
          totalThoughts: normalized.totalThoughts,
          nextThoughtNeeded: normalized.nextThoughtNeeded,
          branches: state.branches,
          thoughtHistoryLength: state.history.length,
        });
      },
    }),
  ];
}
