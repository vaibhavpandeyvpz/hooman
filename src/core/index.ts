import type { Agent, InterventionHandler } from "@strands-agents/sdk";
import { Config } from "./config.js";
import { create as createAgent } from "./agent/index.js";
import type { SessionTitleCallback } from "./agent/session-title-plugin.js";
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
  /** Notified when the session-title plugin generates a title for this agent's session. */
  onSessionTitle?: SessionTitleCallback;
  acp?: AcpMeta;
};

export type BootstrapMode = "default" | "daemon" | "acp";

export type AcpMeta = {
  mcpServers?: NamedMcpTransport[];
  /**
   * Also load the local MCP config (`~/.hooman/mcp.json` plus repo-local
   * `.hooman/mcp.json` overlays) as usual, instead of only session-scoped
   * servers. Enabled for trusted first-party clients (the official VS Code
   * extension identifies itself via `_meta["hoomanjs/vscode"]`).
   */
  vscode?: boolean;
  /** Session working directory used to discover repo-local MCP overlays. */
  cwd?: string;
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
  const mcpConfig = createRuntimeMcpConfig(meta.acp?.cwd);
  // In ACP mode MCP servers are session-scoped (supplied by the client) and
  // the local mcp.json is skipped — unless the client is a trusted first-party
  // surface that asked for the regular local config to load as well.
  const skipLocalMcpConfig = mode === "acp" && meta.acp?.vscode !== true;
  const mcpManager = createMcpManager(
    mcpConfig,
    skipLocalMcpConfig,
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
    onSessionTitle: meta?.onSessionTitle,
  });
  return { config, agent, mcp, registry };
}
