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

/** Last UUID segment (or whole string) for a compact session label. */
function shortSessionId(sessionId: string): string {
  const parts = sessionId.split("-");
  return parts.length > 1 ? (parts[parts.length - 1] ?? sessionId) : sessionId;
}

function sessionModeValueColor(mode: string): string {
  if (mode === "plan") {
    return "#FFA500";
  }
  if (mode === "ask") {
    return "cyan";
  }
  return "gray";
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
  const sessionShort = shortSessionId(sessionId);
  const displayStatus = statusLabel ?? status;

  return (
    <Box marginTop={1} flexDirection="column">
      <Text>
        <Text color="gray">session: </Text>
        <Text color="gray">{sessionShort}</Text>
        <Text color="gray"> • status: </Text>
        <Text color={statusValueColor(status)}>{displayStatus}</Text>
        <Text color="gray"> • mode: </Text>
        <Text color={sessionModeValueColor(sessionMode)}>{sessionMode}</Text>
        <Text color="gray"> • yolo: </Text>
        <Text color={yoloOn ? "red" : "green"}>{yoloOn ? "on" : "off"}</Text>
      </Text>
      <Text color="gray">
        model: {currentModel} • turns: {turnCount} • tokens: {usage.inputTokens}{" "}
        + {usage.outputTokens} = {usage.totalTokens}
        {usage.latencyMs > 0 ? ` • latency: ${usage.latencyMs}ms` : ""}
        {running ? ` • elapsed ${elapsedLabel}` : ""}
      </Text>
      <Text color="gray">
        {`mcp servers: ${manager.clients.size} • tools: ${totalTools} • skills: ${skillsFound}`}
      </Text>
    </Box>
  );
}
