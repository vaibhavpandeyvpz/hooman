import { Box, Text } from "ink";
import type { Manager as McpManager } from "../../core/mcp/index.js";

type StatusBarProps = {
  running: boolean;
  status: string;
  statusLabel?: string;
  sessionId: string;
  currentModel: string;
  elapsedLabel: string;
  turnCount: number;
  totalTools: number;
  skillsFound: number;
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
  statusLabel,
  sessionId,
  currentModel,
  elapsedLabel,
  turnCount,
  totalTools,
  skillsFound,
  manager,
  usage,
}: StatusBarProps) {
  return (
    <Box marginTop={1} flexDirection="column">
      <Text>
        <Text color="gray">status: </Text>
        <Text color={statusValueColor(status)}>{statusLabel ?? status}</Text>
        <Text color="gray"> • session: {sessionId}</Text>
      </Text>
      <Text color="gray">model: {currentModel}</Text>
      <Text color="gray">
        turns: {turnCount} • tokens in/out/total: {usage.inputTokens}/
        {usage.outputTokens}/{usage.totalTokens}
        {usage.latencyMs > 0 ? ` • latency: ${usage.latencyMs}ms` : ""}
        {running ? <Text color="gray"> • elapsed {elapsedLabel}</Text> : null}
      </Text>
      <Text color="gray">
        {`mcp servers: ${manager.clients.size} • tools: ${totalTools} • skills: ${skillsFound}`}
      </Text>
    </Box>
  );
}
