import { Box, Text } from "ink";
import type { Manager as McpManager } from "../../core/mcp/index.js";

type StatusBarProps = {
  running: boolean;
  status: string;
  statusLabel?: string;
  sessionId: string;
  currentModel: string;
  yoloOn: boolean;
  sessionMode: string;
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

function sessionModeValueColor(mode: string): string {
  return mode === "plan" ? "#FFA500" : "gray";
}

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
  yoloOn,
  sessionMode,
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
      <Text>
        <Text color="gray">yolo: </Text>
        <Text color={yoloOn ? "red" : "green"}>{yoloOn ? "on" : "off"}</Text>
        <Text color="gray"> • mode: </Text>
        <Text color={sessionModeValueColor(sessionMode)}>{sessionMode}</Text>
      </Text>
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
