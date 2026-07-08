export const ACTIVE_MCP_TOOL_NAMES_STATE_KEY = "mcp.activeToolNames";

export type AppStateLike = {
  get<T = unknown>(key: string): T;
  set(key: string, value: unknown): void;
};

export type AgentLike = {
  appState: AppStateLike;
};

function normalizeActiveNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      ),
    ),
  ];
}

export function getActiveMcpToolNames(agent: AgentLike): string[] {
  return normalizeActiveNames(
    agent.appState.get(ACTIVE_MCP_TOOL_NAMES_STATE_KEY),
  );
}

export function activateMcpTool(agent: AgentLike, name: string): void {
  const normalized = name.trim();
  if (!normalized) {
    return;
  }
  const active = new Set(getActiveMcpToolNames(agent));
  active.add(normalized);
  agent.appState.set(ACTIVE_MCP_TOOL_NAMES_STATE_KEY, [...active]);
}
