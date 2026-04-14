import type { Agent } from "@strands-agents/sdk";
import { Config } from "./config.ts";
import { create as createAgent } from "./agent/index.ts";
import {
  createMcpConfig,
  createMcpManager,
  type Config as McpServersConfig,
  type Manager as McpConnectionManager,
} from "./mcp/index.ts";
import { createSkillsRegistry } from "./skills/index.ts";
import type { Registry } from "./skills/index.ts";
import { system as createSystemPrompt } from "./prompts/index.ts";
import type { Toolkit } from "./toolkit.ts";
import {
  basePath,
  configJsonPath,
  instructionsMdPath,
  mcpJsonPath,
} from "./utils/paths.ts";

export async function bootstrap(
  meta: {
    userId?: string;
    sessionId: string;
    systemPrompt?: string;
    toolkit?: Toolkit;
  },
  print: boolean = false,
): Promise<{
  config: Config;
  agent: Agent;
  mcp: { config: McpServersConfig; manager: McpConnectionManager };
  registry: Registry;
}> {
  const config = new Config(configJsonPath());
  const mcpConfig = createMcpConfig(mcpJsonPath());
  const mcpManager = createMcpManager(mcpConfig);
  const mcp = { config: mcpConfig, manager: mcpManager };
  const registry = createSkillsRegistry(basePath());
  const toolkit = meta.toolkit ?? "max";
  const system = await createSystemPrompt(
    instructionsMdPath(),
    config,
    toolkit,
  );
  const sessionId = meta?.sessionId ?? crypto.randomUUID();
  const agent = await createAgent(config, system, registry, mcp, print, {
    userId: meta?.userId ?? sessionId,
    sessionId,
    systemPrompt: meta?.systemPrompt,
    toolkit,
  });
  return { config, agent, mcp, registry };
}
