import type { Agent } from "@strands-agents/sdk";
import { Config } from "./config.js";
import { create as createAgent } from "./agent/index.js";
import type { SessionMode } from "./state/session-mode.js";
import {
  createMcpConfig,
  createMcpManager,
  type Config as McpServersConfig,
  type Manager as McpConnectionManager,
  type NamedMcpTransport,
} from "./mcp/index.js";
import { createSkillsRegistry } from "./skills/index.js";
import type { Registry } from "./skills/index.js";
import { system as createSystemPrompt } from "./prompts/index.js";
import {
  basePath,
  configJsonPath,
  instructionsMdPath,
  mcpJsonPath,
} from "./utils/paths.js";

export type BootstrapMeta = {
  userId?: string;
  sessionId?: string;
  /** When true, seeds `hooman.yolo` on the agent appState (auto-approve tools). */
  yolo?: boolean;
  /** Seeds session mode on agent appState (`default` vs `plan`). */
  sessionMode?: SessionMode;
  acp?: AcpMeta;
};

export type BootstrapMode = "default" | "daemon" | "acp";

export type AcpMeta = {
  systemPrompt?: string;
  mcpServers?: NamedMcpTransport[];
};

export async function bootstrap(
  mode: BootstrapMode,
  meta: BootstrapMeta,
  print: boolean = false,
  config: Config = new Config(configJsonPath()),
): Promise<{
  config: Config;
  agent: Agent;
  mcp: { config: McpServersConfig; manager: McpConnectionManager };
  registry: Registry;
}> {
  const mcpConfig = createMcpConfig(mcpJsonPath());
  const mcpManager = createMcpManager(
    mcpConfig,
    mode === "acp",
    meta.acp?.mcpServers ?? [],
  );
  const mcp = { config: mcpConfig, manager: mcpManager };
  const registry = createSkillsRegistry(basePath());
  const system = await createSystemPrompt(instructionsMdPath(), config, mode);
  const agent = await createAgent(config, system, registry, mcp, print, {
    userId: meta?.userId ?? meta?.sessionId,
    sessionId: meta?.sessionId,
    systemPrompt: meta?.acp?.systemPrompt,
    yolo: meta?.yolo,
    sessionMode: meta?.sessionMode,
  });
  return { config, agent, mcp, registry };
}
