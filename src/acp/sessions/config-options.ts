import { RequestError } from "@agentclientprotocol/sdk";
import type {
  SessionConfigOption,
  SetSessionConfigOptionRequest,
} from "@agentclientprotocol/sdk";
import type { Config } from "../../core/config.ts";

export const HOOMAN_LTM_CONFIG_ID = "hooman.longTermMemory" as const;
export const HOOMAN_WIKI_CONFIG_ID = "hooman.wiki" as const;

export function buildSessionConfigOptions(
  config: Config,
): SessionConfigOption[] {
  return [
    {
      type: "select",
      id: HOOMAN_LTM_CONFIG_ID,
      name: "Long-term memory",
      description:
        "When enabled, the agent can store and search memories (requires Chroma at the configured URL).",
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
        "When enabled, the agent can read, write, and search wiki pages (requires Chroma at the configured URL).",
      category: "_hooman",
      currentValue: config.wiki.enabled ? "on" : "off",
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
  if (
    params.configId !== HOOMAN_LTM_CONFIG_ID &&
    params.configId !== HOOMAN_WIKI_CONFIG_ID
  ) {
    throw RequestError.invalidParams({ configId: params.configId });
  }
  const value = params.value;
  if (value !== "on" && value !== "off") {
    throw RequestError.invalidParams({ value });
  }
  if (params.configId === HOOMAN_LTM_CONFIG_ID) {
    const chroma = config.ltm.chroma;
    config.update({
      features: {
        ...config.features,
        ltm: {
          enabled: value === "on",
          chroma: {
            url: chroma.url,
            collection: { memory: chroma.collection.memory },
          },
        },
      },
    });
    return;
  }

  const chroma = config.wiki.chroma;
  config.update({
    features: {
      ...config.features,
      wiki: {
        enabled: value === "on",
        chroma: {
          url: chroma.url,
          collection: { wiki: chroma.collection.wiki },
        },
      },
    },
  });
}
