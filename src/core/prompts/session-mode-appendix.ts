import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LocalAgent } from "@strands-agents/sdk";
import { getModeState } from "../state/session-mode.js";
import type { SessionMode } from "../state/session-mode.js";

const SECTION_BREAK = "\n\n---\n\n";

let cachedPlanAppendix: string | null = null;
let cachedAskAppendix: string | null = null;

function readBundledModeFile(file: "plan.md" | "ask.md"): string {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "modes");
  const full = join(dir, file);
  if (!existsSync(full)) {
    return "";
  }
  return readFileSync(full, "utf8").trim();
}

function appendixForMode(mode: SessionMode): string {
  switch (mode) {
    case "plan": {
      if (cachedPlanAppendix === null) {
        cachedPlanAppendix = readBundledModeFile("plan.md");
      }
      return cachedPlanAppendix;
    }
    case "ask": {
      if (cachedAskAppendix === null) {
        cachedAskAppendix = readBundledModeFile("ask.md");
      }
      return cachedAskAppendix;
    }
    default:
      return "";
  }
}

export function composeSystemPromptWithSessionMode(
  base: string,
  mode: SessionMode,
): string {
  const extra = appendixForMode(mode);
  if (!extra) {
    return base;
  }
  if (!base) {
    return extra;
  }
  return `${base}${SECTION_BREAK}${extra}`;
}

/** Applies the session-mode appendix to `base` and updates `agent.systemPrompt` when it changes. */
export function refreshAgentSystemPromptForSessionMode(
  agent: LocalAgent,
  base: string,
): void {
  const mode = getModeState(agent).mode;
  const next = composeSystemPromptWithSessionMode(base, mode);
  const cur = typeof agent.systemPrompt === "string" ? agent.systemPrompt : "";
  if (cur !== next && typeof agent.systemPrompt === "string") {
    agent.systemPrompt = next;
  }
}
