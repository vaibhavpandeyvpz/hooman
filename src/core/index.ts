import type { Agent, InterventionHandler } from "@strands-agents/sdk";
import { Config } from "./config.js";
import { create as createAgent } from "./agent/index.js";
import type { SessionMode } from "./state/session-mode.js";
import {
  createMcpManager,
  type Config as McpServersConfig,
  type Manager as McpConnectionManager,
  type NamedMcpTransport,
} from "./mcp/index.js";
import {
  createRuntimeConfig,
  createRuntimeMcpConfig,
} from "./runtime-config.js";
import { createSkillsRegistry } from "./skills/index.js";
import type { Registry } from "./skills/index.js";
import { system as createSystemPrompt } from "./prompts/index.js";
import { basePath, instructionsMdPath } from "./utils/paths.js";

export type BootstrapMeta = {
  userId?: string;
  sessionId?: string;
  /** When true, seeds `hooman.yolo` on the agent appState (auto-approve tools). */
  yolo?: boolean;
  /** Seeds session mode on agent appState (`agent`, `ask`, or `plan`). */
  mode?: SessionMode;
  interventions?: InterventionHandler[];
  createInterventions?: (deps: {
    manager: McpConnectionManager;
  }) => InterventionHandler[];
  acp?: AcpMeta;
};

export type BootstrapMode = "default" | "daemon" | "acp";

export type AcpMeta = {
  mcpServers?: NamedMcpTransport[];
};

export async function bootstrap(
  mode: BootstrapMode,
  meta: BootstrapMeta,
  print: boolean = false,
  config: Config = createRuntimeConfig(),
): Promise<{
  config: Config;
  agent: Agent;
  mcp: { config: McpServersConfig; manager: McpConnectionManager };
  registry: Registry;
}> {
  const mcpConfig = createRuntimeMcpConfig();
  const mcpManager = createMcpManager(
    mcpConfig,
    mode === "acp",
    meta.acp?.mcpServers ?? [],
  );
  const mcp = { config: mcpConfig, manager: mcpManager };
  const registry = createSkillsRegistry(basePath());
  const system = await createSystemPrompt(instructionsMdPath(), config, mode);
  const interventions = [
    ...(meta.interventions ?? []),
    ...(meta.createInterventions?.({ manager: mcpManager }) ?? []),
  ];
  const agent = await createAgent(config, system, mcp, print, {
    userId: meta?.userId ?? meta?.sessionId,
    sessionId: meta?.sessionId,
    yolo: meta?.yolo,
    mode: meta?.mode,
    interventions,
  });
  return { config, agent, mcp, registry };
}
