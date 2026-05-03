import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import handlebars from "handlebars";
import type { LocalAgent } from "@strands-agents/sdk";
import {
  PLAN_ENTERED_AT_STATE_KEY,
  PLAN_ENTER_REASON_STATE_KEY,
  PLAN_FILE_STATE_KEY,
} from "../state/plan.js";
import {
  getModeState,
  MODE_STATE_KEY,
  type SessionMode,
} from "../state/session-mode.js";

const { compile } = handlebars;

const SECTION_BREAK = "\n\n---\n\n";

/** Keys exposed as `state` in session-mode Handlebars templates (e.g. plan.md). */
const SESSION_MODE_TEMPLATE_STATE_KEYS = [
  MODE_STATE_KEY,
  PLAN_FILE_STATE_KEY,
  PLAN_ENTER_REASON_STATE_KEY,
  PLAN_ENTERED_AT_STATE_KEY,
] as const;

let cachedPlanTemplateSource: string | null = null;
let cachedPlanTemplateCompiled: ReturnType<typeof compile> | null = null;
let cachedAskAppendix: string | null = null;

const systemPromptBaseBuilders = new WeakMap<
  LocalAgent,
  () => Promise<string>
>();

export function registerAgentSystemPromptBaseBuilder(
  agent: LocalAgent,
  buildBase: () => Promise<string>,
): void {
  systemPromptBaseBuilders.set(agent, buildBase);
}

/** Rebuild base instructions from disk/config and re-apply the session-mode appendix. */
export async function refreshAgentFullSystemPrompt(
  agent: LocalAgent,
): Promise<void> {
  const build = systemPromptBaseBuilders.get(agent);
  if (!build) {
    return;
  }
  const base = await build();
  refreshAgentSystemPromptForSessionMode(agent, base);
}

function readBundledModeFile(file: "plan.md" | "ask.md"): string {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "modes");
  const full = join(dir, file);
  if (!existsSync(full)) {
    return "";
  }
  return readFileSync(full, "utf8").trim();
}

/** Plain snapshot of selected `appState` entries for mode prompts (Handlebars `state`). */
export function snapshotAppStateForSessionModePrompt(agent: {
  appState: { get(key: string): unknown };
}): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  for (const key of SESSION_MODE_TEMPLATE_STATE_KEYS) {
    state[key] = agent.appState.get(key);
  }
  return state;
}

function renderPlanAppendix(state: Record<string, unknown>): string {
  if (cachedPlanTemplateSource === null) {
    cachedPlanTemplateSource = readBundledModeFile("plan.md");
  }
  if (!cachedPlanTemplateSource) {
    return "";
  }
  if (cachedPlanTemplateCompiled === null) {
    cachedPlanTemplateCompiled = compile(cachedPlanTemplateSource, {
      strict: false,
    });
  }
  return cachedPlanTemplateCompiled({ state }).trim();
}

function appendixForMode(
  mode: SessionMode,
  state: Record<string, unknown>,
): string {
  switch (mode) {
    case "plan":
      return renderPlanAppendix(state);
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
  /** Values read as `state` in plan mode Handlebars (e.g. `lookup state 'hooman.planFile'`). */
  sessionModeState: Record<string, unknown> = {},
): string {
  const extra = appendixForMode(mode, sessionModeState);
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
  const sessionModeState = snapshotAppStateForSessionModePrompt(agent);
  const next = composeSystemPromptWithSessionMode(base, mode, sessionModeState);
  const cur = typeof agent.systemPrompt === "string" ? agent.systemPrompt : "";
  if (cur !== next && typeof agent.systemPrompt === "string") {
    agent.systemPrompt = next;
  }
}
