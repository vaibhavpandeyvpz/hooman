import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { BeforeToolCallEvent } from "@strands-agents/sdk";
import type { Config } from "../core/config.ts";

const INTERNAL_ALWAYS_ALLOWED = new Set(["strands_structured_output"]);
const INPUT_PREVIEW_LIMIT = 1_024;

type ApprovalDecision = "allow" | "reject" | "always";

function inputPreview(input: unknown): string {
  try {
    const text = JSON.stringify(input, null, 2) ?? "null";
    return text.length > INPUT_PREVIEW_LIMIT
      ? `${text.slice(0, INPUT_PREVIEW_LIMIT)}\n... (truncated)`
      : text;
  } catch {
    return String(input);
  }
}

function canPromptForApproval(): boolean {
  return Boolean(stdin.isTTY && stdout.isTTY);
}

async function promptForApproval(
  event: BeforeToolCallEvent,
): Promise<ApprovalDecision> {
  const rl = createInterface({ input: stdin, output: stdout });
  const description = event.tool?.description?.trim();
  const preview = inputPreview(event.toolUse.input);
  try {
    stdout.write(`\nTool approval required\n`);
    stdout.write(`Tool: ${event.toolUse.name}\n`);
    if (description) {
      stdout.write(`Description: ${description}\n`);
    }
    stdout.write(`Input:\n${preview}\n`);
    stdout.write(`Options: [a]llow once, [r]eject, [A]lways allow\n`);
    while (true) {
      const answer = (await rl.question("> ")).trim();
      if (answer === "a" || answer === "allow" || answer === "") {
        return "allow";
      }
      if (answer === "r" || answer === "reject") {
        return "reject";
      }
      if (answer === "A" || answer === "always") {
        return "always";
      }
      stdout.write("Enter a, r, or A.\n");
    }
  } finally {
    rl.close();
  }
}

type BeforeToolCallEventHandler = (event: BeforeToolCallEvent) => Promise<void>;

export function createToolApprovalHandler(
  config: Config,
  options?: { yolo?: boolean },
): BeforeToolCallEventHandler {
  return async function onBeforeToolCallEvent(event: BeforeToolCallEvent) {
    const name = event.toolUse.name;
    if (options?.yolo) {
      return;
    }
    if (
      INTERNAL_ALWAYS_ALLOWED.has(name) ||
      config.tools.allowed.includes(name)
    ) {
      return;
    }
    if (!canPromptForApproval()) {
      event.cancel = `Tool "${name}" requires approval, but no interactive terminal is available. Add it to config.tools.allowed to always allow it.`;
      return;
    }
    const decision = await promptForApproval(event);
    if (decision === "allow") {
      return;
    }
    if (decision === "always") {
      config.update({ tools: { allowed: [...config.tools.allowed, name] } });
      return;
    }
    event.cancel = `Tool "${name}" was rejected by the user.`;
  };
}
