import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { Config } from "../core/config.js";
import { MODE_DEFINITIONS } from "../core/modes/definitions.js";
import type { SessionMode } from "../core/modes/schema.js";
import {
  currentReasoningEffort,
  REASONING_EFFORT_LEVELS,
  REASONING_EFFORT_OFF,
} from "../core/models/reasoning-effort.js";

/** Config option id for the session mode selector (mirrors `session/set_mode`). */
export const CONFIG_ID_MODE = "mode";
/** Config option id for the language-model selector. */
export const CONFIG_ID_MODEL = "model";
/** Config option id for the reasoning-effort selector. */
export const CONFIG_ID_EFFORT = "effort";

/** Name of the currently-active (default) named LLM, if any are configured. */
export function currentModelName(config: Config): string | undefined {
  return (
    config.llms.find((entry) => entry.default)?.name ?? config.llms[0]?.name
  );
}

/**
 * Build the ACP `configOptions` advertised for a session: a language-model
 * selector (the requested feature) followed by the session-mode selector.
 *
 * Session Config Options supersede the older `modes` field; agents that expose
 * mode-like config should send both and keep them in sync during the transition
 * (see https://agentclientprotocol.com/protocol/v1/session-config-options).
 */
export function buildSessionConfigOptions(
  config: Config,
  currentMode: SessionMode,
): SessionConfigOption[] {
  const options: SessionConfigOption[] = [];

  const modelValues = config.llms.map((llm) => ({
    value: llm.name,
    name: llm.name,
    description: `${llm.provider}/${llm.options.model}`,
  }));
  const currentModel = currentModelName(config);
  if (modelValues.length > 0 && currentModel) {
    options.push({
      id: CONFIG_ID_MODEL,
      name: "Model",
      description: "Language model used for this session",
      category: "model",
      type: "select",
      currentValue: currentModel,
      options: modelValues,
    });
  }

  // Reasoning effort applies to the active model's provider. The `off` value
  // maps to "no reasoning" (see reasoning-effort helpers).
  if (modelValues.length > 0 && currentModel) {
    options.push({
      id: CONFIG_ID_EFFORT,
      name: "Reasoning Effort",
      description: "Reasoning/thinking effort for the active model",
      category: "model",
      type: "select",
      currentValue: currentReasoningEffort(config) ?? REASONING_EFFORT_OFF,
      options: [
        {
          value: REASONING_EFFORT_OFF,
          name: REASONING_EFFORT_OFF,
          description: "No reasoning",
        },
        ...REASONING_EFFORT_LEVELS.map((level) => ({
          value: level,
          name: level,
          description: `${level} reasoning effort`,
        })),
      ],
    });
  }

  options.push({
    id: CONFIG_ID_MODE,
    name: "Session Mode",
    description: "Controls the tool surface and permission behaviour",
    category: "mode",
    type: "select",
    currentValue: currentMode,
    options: MODE_DEFINITIONS.map((mode) => ({
      value: mode.id,
      name: mode.name,
      description: mode.description,
    })),
  });

  return options;
}
