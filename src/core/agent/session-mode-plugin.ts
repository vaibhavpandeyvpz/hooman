import handlebars from "handlebars";
import { ContextInjector } from "@strands-agents/sdk/vended-plugins/context-injector";
import { hasBundledPrompt, readBundledPrompt } from "../prompts/bundled.js";
import {
  getModeDefinition,
  type ModeDefinition,
} from "../modes/definitions.js";
import {
  PLAN_ENTERED_AT_STATE_KEY,
  PLAN_ENTER_REASON_STATE_KEY,
  PLAN_FILE_STATE_KEY,
  PLAN_LAST_FILE_STATE_KEY,
} from "../state/plan.js";
import {
  getModeState,
  MODE_STATE_KEY,
  type SessionMode,
} from "../state/session-mode.js";

const { compile } = handlebars;

/** Keys exposed as `state` in session-mode Handlebars templates (e.g. plan.md). */
const SESSION_MODE_TEMPLATE_STATE_KEYS = [
  MODE_STATE_KEY,
  PLAN_FILE_STATE_KEY,
  PLAN_LAST_FILE_STATE_KEY,
  PLAN_ENTER_REASON_STATE_KEY,
  PLAN_ENTERED_AT_STATE_KEY,
] as const;

const cachedModeTemplates = new Map<string, ReturnType<typeof compile>>();

function readBundledModeFile(file: string): string {
  const parts = file.split("/");
  if (!hasBundledPrompt(...parts)) {
    return "";
  }
  return readBundledPrompt(...parts);
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

function renderModePrompt(
  config: ModeDefinition,
  state: Record<string, unknown>,
): string {
  let compiled = cachedModeTemplates.get(config.id);
  if (!compiled) {
    const source = readBundledModeFile(config.instructions);
    if (!source) {
      return "";
    }
    compiled = compile(source, { strict: false });
    cachedModeTemplates.set(config.id, compiled);
  }
  return compiled({ state }).trim();
}

export function renderSessionModePrompt(
  mode: SessionMode,
  sessionModeState: Record<string, unknown> = {},
): string {
  const config = getModeDefinition(mode);
  if (!config) {
    return "";
  }
  return renderModePrompt(config, sessionModeState);
}

export function createSessionModePromptPlugin(): ContextInjector {
  return new ContextInjector({
    name: "hooman:session-mode-prompt",
    trigger: "userTurn",
    renderContent: async ({ agent }) => {
      const mode = getModeState(agent).mode;
      const sessionModeState = snapshotAppStateForSessionModePrompt(agent);
      return renderSessionModePrompt(mode, sessionModeState);
    },
  });
}
