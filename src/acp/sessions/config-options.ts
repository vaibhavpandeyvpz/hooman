import { RequestError } from "@agentclientprotocol/sdk";
import type {
  SessionConfigOption,
  SetSessionConfigOptionRequest,
} from "@agentclientprotocol/sdk";
import type { Agent } from "@strands-agents/sdk";
import type { Config } from "../../core/config.js";
import type { SessionConfig } from "../../core/session-config.js";
import { applySessionMode } from "../../core/agent/sync-tool-registry-mode.js";
import {
  getModeState,
  SessionModeSchema,
  setSessionMode,
} from "../../core/state/session-mode.js";
import {
  YOLO_STATE_KEY,
  isYoloEnabled,
  setYoloEnabled,
} from "../../core/state/yolo.js";

export const HOOMAN_SESSION_MODE_CONFIG_ID = "hooman.sessionMode" as const;
export const HOOMAN_LTM_CONFIG_ID = "hooman.longTermMemory" as const;
export const HOOMAN_WIKI_CONFIG_ID = "hooman.wiki" as const;
export const HOOMAN_MODEL_CONFIG_ID = "hooman.model" as const;
/** Same key as agent {@link YOLO_STATE_KEY}. */
export const HOOMAN_YOLO_CONFIG_ID = YOLO_STATE_KEY;

export function buildSessionConfigOptions(
  config: Config | SessionConfig,
  agent: Agent,
): SessionConfigOption[] {
  const defaultLlm = config.llms.find((m) => m.default) ?? config.llms[0]!;
  return [
    {
      type: "select",
      id: HOOMAN_SESSION_MODE_CONFIG_ID,
      name: "Session mode",
      description:
        "Default: full tools. Plan: read only tools plus plan file workflow. Ask: same read only tools without enter/exit plan.",
      category: "mode",
      currentValue: getModeState(agent).mode,
      options: [
        {
          value: "default",
          name: "Default",
          description: "Standard behaviour with the full tool surface.",
        },
        {
          value: "plan",
          name: "Plan",
          description:
            "Planning phase with read-only exploration tools and a plan document.",
        },
        {
          value: "ask",
          name: "Ask",
          description:
            "Like plan mode’s read only tools for Q&A and exploration, without plan-mode tools.",
        },
      ],
    },
    {
      type: "select",
      id: HOOMAN_MODEL_CONFIG_ID,
      name: "Model",
      category: "model",
      currentValue: defaultLlm.name,
      options: config.llms.map((m) => ({
        value: m.name,
        name: m.name,
        description: `${m.options.provider}/${m.options.model}`,
      })),
    },
    {
      type: "select",
      id: HOOMAN_LTM_CONFIG_ID,
      name: "Long-term memory",
      description:
        "When enabled, the agent can store and search long-term memories (local SQLite + sqlite-vec).",
      category: "_hooman",
      currentValue: config.ltm.enabled ? "on" : "off",
      options: [
        { value: "on", name: "On" },
        { value: "off", name: "Off" },
      ],
    },
    {
      type: "select",
      id: HOOMAN_WIKI_CONFIG_ID,
      name: "Wiki",
      description:
        "When enabled, the agent can read, write, and search wiki pages (local QMD index under $HOOMAN_HOME/wiki/.qmd).",
      category: "_hooman",
      currentValue: config.wiki.enabled ? "on" : "off",
      options: [
        { value: "on", name: "On" },
        { value: "off", name: "Off" },
      ],
    },
    {
      type: "select",
      id: HOOMAN_YOLO_CONFIG_ID,
      name: "Auto-approve tools",
      description:
        "When enabled, tool calls run without interactive ACP approval prompts for this session.",
      category: "_hooman",
      currentValue: isYoloEnabled(agent) ? "on" : "off",
      options: [
        { value: "on", name: "On" },
        { value: "off", name: "Off" },
      ],
    },
  ];
}

export function applySessionConfigOption(
  config: SessionConfig,
  params: SetSessionConfigOptionRequest,
  agent: Agent,
): void {
  if ("type" in params && params.type === "boolean") {
    throw RequestError.invalidParams({
      message: "Boolean session config options are not supported.",
    });
  }
  if (
    params.configId !== HOOMAN_SESSION_MODE_CONFIG_ID &&
    params.configId !== HOOMAN_LTM_CONFIG_ID &&
    params.configId !== HOOMAN_WIKI_CONFIG_ID &&
    params.configId !== HOOMAN_MODEL_CONFIG_ID &&
    params.configId !== HOOMAN_YOLO_CONFIG_ID
  ) {
    throw RequestError.invalidParams({ configId: params.configId });
  }
  const value = params.value;
  if (params.configId === HOOMAN_SESSION_MODE_CONFIG_ID) {
    const parsed = SessionModeSchema.safeParse(value);
    if (!parsed.success) {
      throw RequestError.invalidParams({ value });
    }
    setSessionMode(agent, parsed.data);
    applySessionMode(agent);
    return;
  }
  if (params.configId === HOOMAN_MODEL_CONFIG_ID) {
    if (
      typeof value !== "string" ||
      !config.llms.some((m) => m.name === value)
    ) {
      throw RequestError.invalidParams({ value });
    }
    config.update({
      llms: config.llms.map((m) => ({ ...m, default: m.name === value })),
    });
    return;
  }
  if (value !== "on" && value !== "off") {
    throw RequestError.invalidParams({ value });
  }
  const tools = config.tools;
  if (params.configId === HOOMAN_LTM_CONFIG_ID) {
    config.update({
      tools: {
        ...tools,
        ltm: {
          ...tools.ltm,
          enabled: value === "on",
        },
      },
    });
    return;
  }
  if (params.configId === HOOMAN_YOLO_CONFIG_ID) {
    setYoloEnabled(agent, value === "on");
    return;
  }

  config.update({
    tools: {
      ...tools,
      wiki: {
        ...tools.wiki,
        enabled: value === "on",
      },
    },
  });
}
