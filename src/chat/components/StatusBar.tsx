import { Box, Text } from "ink";
import type { Manager as McpManager } from "../../core/mcp/index.ts";

type StatusBarProps = {
  running: boolean;
  status: string;
  sessionId: string;
  elapsedLabel: string;
  turnCount: number;
  /** MCP tools returned from servers (same set wired into the agent). */
  toolsFound: number;
  toolCalls: number;
  manager: McpManager;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    latencyMs: number;
  };
};

/** Ink color for the live status token only (labels stay `gray`). */
function statusValueColor(status: string): string {
  switch (status) {
    case "ready":
      return "green";
    case "thinking":
    case "streaming":
    case "running tool":
    case "cancel requested":
      return "yellow";
    default:
      return "gray";
  }
}

export function StatusBar({
  running,
  status,
  sessionId,
  elapsedLabel,
  turnCount,
  toolsFound,
  toolCalls,
  manager,
  usage,
}: StatusBarProps) {
  return (
    <Box marginTop={1} flexDirection="column">
      <Text>
        <Text color="gray">status: </Text>
        <Text color={statusValueColor(status)}>{status}</Text>
        <Text color="gray"> • session: {sessionId}</Text>
        {running ? <Text color="gray"> • elapsed {elapsedLabel}</Text> : null}
      </Text>
      <Text color="gray">
        turns: {turnCount} • tokens in/out/total: {usage.inputTokens}/
        {usage.outputTokens}/{usage.totalTokens}
        {usage.latencyMs > 0 ? ` • latency: ${usage.latencyMs}ms` : ""}
      </Text>
      <Text color="gray">
        {`mcp clients: ${manager.clients.size} • tools found: ${toolsFound} • tools active: ${toolCalls}`}
      </Text>
    </Box>
  );
}
