import type { ToolContext } from "@strands-agents/sdk";

const THINKING_STATE_KEY = "thinking.sequential";

export type ThoughtEntry = {
  thought: string;
  thoughtNumber: number;
  totalThoughts: number;
  nextThoughtNeeded: boolean;
  isRevision: boolean;
  revisesThought: number | null;
  branchFromThought: number | null;
  branchId: string | null;
  needsMoreThoughts: boolean;
};

export type ThinkingState = {
  history: ThoughtEntry[];
  branches: string[];
};

function isThinkingState(value: unknown): value is ThinkingState {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "history" in value &&
    "branches" in value &&
    Array.isArray(value.history) &&
    Array.isArray(value.branches)
  );
}

export function readThinkingState(context: ToolContext): ThinkingState {
  const current = context.agent.appState.get(THINKING_STATE_KEY);

  if (isThinkingState(current)) {
    return current;
  }

  return { history: [], branches: [] };
}

export function writeThinkingState(
  context: ToolContext,
  state: ThinkingState,
): void {
  context.agent.appState.set(THINKING_STATE_KEY, state);
}
