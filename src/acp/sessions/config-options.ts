import { RequestError } from "@agentclientprotocol/sdk";
import type {
  SessionConfigOption,
  SetSessionConfigOptionRequest,
} from "@agentclientprotocol/sdk";
import type { Config } from "../../core/config.ts";

export const HOOMANITY_LTM_CONFIG_ID = "hoomanity.longTermMemory" as const;

export function buildSessionConfigOptions(
  config: Config,
): SessionConfigOption[] {
  return [
    {
      type: "select",
      id: HOOMANITY_LTM_CONFIG_ID,
      name: "Long-term memory",
      description:
        "When enabled, the agent can store and search memories (requires Chroma at the configured URL).",
      category: "_hoomanity",
      currentValue: config.ltm.enabled ? "on" : "off",
      options: [
        { value: "on", name: "On" },
        { value: "off", name: "Off" },
      ],
    },
  ];
}

export function applySessionConfigOption(
  config: Config,
  params: SetSessionConfigOptionRequest,
): void {
  if ("type" in params && params.type === "boolean") {
    throw RequestError.invalidParams({
      message: "Boolean session config options are not supported.",
    });
  }
  if (params.configId !== HOOMANITY_LTM_CONFIG_ID) {
    throw RequestError.invalidParams({ configId: params.configId });
  }
  const value = params.value;
  if (value !== "on" && value !== "off") {
    throw RequestError.invalidParams({ value });
  }
  const chroma = config.ltm.chroma;
  config.update({
    ltm: {
      enabled: value === "on",
      chroma: {
        url: chroma.url,
        collection: { memory: chroma.collection.memory },
      },
    },
  });
}
