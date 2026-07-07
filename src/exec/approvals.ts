import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { HoomanToolApprovalIntervention } from "../core/approvals/intervention.js";
import type { ToolApprovalResult } from "../core/approvals/intervention.js";
import { EXIT_PLAN_MODE_TOOL } from "../core/state/tool-approvals.js";

function canPromptForApproval(): boolean {
  return Boolean(stdin.isTTY && stdout.isTTY);
}

async function promptForApproval(
  toolName: string,
  description: string | undefined,
  inputPreview: string,
): Promise<ToolApprovalResult> {
  const isPlanExit = toolName === EXIT_PLAN_MODE_TOOL;
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    stdout.write(`\nTool approval required\n`);
    stdout.write(`Tool: ${toolName}\n`);
    if (description) {
      stdout.write(`Description: ${description}\n`);
    }
    stdout.write(`Input:\n${inputPreview}\n`);
    stdout.write(
      isPlanExit
        ? `Options: [a]llow once, [r]eject\n`
        : `Options: [a]llow once, [r]eject, [A]lways allow\n`,
    );
    while (true) {
      const answer = (await rl.question("> ")).trim();
      if (answer === "a" || answer === "allow" || answer === "") {
        return "allow";
      }
      if (answer === "r" || answer === "reject") {
        return "reject";
      }
      if (!isPlanExit && (answer === "A" || answer === "always")) {
        return "always";
      }
      stdout.write(isPlanExit ? "Enter a or r.\n" : "Enter a, r, or A.\n");
    }
  } finally {
    rl.close();
  }
}

export function createToolApprovalIntervention() {
  return new HoomanToolApprovalIntervention({
    ask: async (request) => {
      if (!canPromptForApproval()) {
        return {
          decision: "reject",
          reason: `Tool "${request.toolName}" requires approval, but no interactive terminal is available.`,
        };
      }
      return promptForApproval(
        request.toolName,
        request.description,
        request.inputPreview,
      );
    },
  });
}
