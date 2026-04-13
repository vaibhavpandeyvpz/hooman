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
import { system as createSystemPrompt } from "./prompts/index.ts";
import type { System as SystemPrompt } from "./prompts/index.ts";
import {
  basePath,
  configJsonPath,
  instructionsMdPath,
  mcpJsonPath,
} from "./utils/paths.ts";

export async function bootstrap(
  userId: string,
  sessionId: string,
  print: boolean = false,
): Promise<{
  config: Config;
  agent: Agent;
  mcp: { config: McpServersConfig; manager: McpConnectionManager };
}> {
  const config = new Config(configJsonPath());
  const mcpConfig = createMcpConfig(mcpJsonPath());
  const mcpManager = createMcpManager(mcpConfig);
  const mcp = { config: mcpConfig, manager: mcpManager };
  const registry = createSkillsRegistry(basePath());
  const system = await createSystemPrompt(instructionsMdPath(), config);
  const agent = await createAgent(
    userId,
    sessionId,
    config,
    system,
    registry,
    mcp,
    print,
  );
  return { config, agent, mcp };
}
