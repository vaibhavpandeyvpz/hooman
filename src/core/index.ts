import type { Agent } from "@strands-agents/sdk";
import { Config } from "./config.ts";
import { create as createAgent } from "./agent/index.ts";
import {
  createMcpConfig,
  createMcpManager,
  type Config as McpServersConfig,
  type Manager as McpConnectionManager,
  type NamedMcpTransport,
} from "./mcp/index.ts";
import { createSkillsRegistry } from "./skills/index.ts";
import type { Registry } from "./skills/index.ts";
import { system as createSystemPrompt } from "./prompts/index.ts";
import {
  basePath,
  configJsonPath,
  instructionsMdPath,
  mcpJsonPath,
} from "./utils/paths.ts";

export type BootstrapMeta = {
  userId?: string;
  sessionId?: string;
  mode?: "default" | "daemon";
  acp?: AcpMeta;
};

export type AcpMeta = {
  systemPrompt?: string;
  mcpServers?: NamedMcpTransport[];
};

export async function bootstrap(
  meta: BootstrapMeta,
  print: boolean = false,
): Promise<{
  config: Config;
  agent: Agent;
  mcp: { config: McpServersConfig; manager: McpConnectionManager };
  registry: Registry;
}> {
  const config = new Config(configJsonPath());
  const mcpConfig = createMcpConfig(mcpJsonPath());
  const mcpManager = createMcpManager(
    mcpConfig,
    meta.acp !== undefined,
    meta.acp?.mcpServers ?? [],
  );
  const mcp = { config: mcpConfig, manager: mcpManager };
  const registry = createSkillsRegistry(basePath());
  const system = await createSystemPrompt(
    instructionsMdPath(),
    config,
    meta.mode ?? "default",
  );
  const agent = await createAgent(config, system, registry, mcp, print, {
    userId: meta?.userId ?? meta?.sessionId,
    sessionId: meta?.sessionId,
    systemPrompt: meta?.acp?.systemPrompt,
  });
  return { config, agent, mcp, registry };
}
