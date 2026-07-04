import { Box, Text } from "ink";
import { millify } from "millify";
import type { Manager as McpManager } from "../../core/mcp/index.js";

const TOKEN_MILLIFY_OPTS = {
  lowercase: true,
  precision: 2,
  space: false,
} as const;

function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) {
    return "0";
  }
  return millify(Math.round(n), TOKEN_MILLIFY_OPTS);
}

type StatusBarProps = {
  running: boolean;
  status: string;
  currentModel: string;
  reasoningEffort?: string;
  yoloOn: boolean;
  sessionMode: string;
  elapsedLabel: string;
  turnCount: number;
  totalTools: number;
  skillsFound: number;
  manager: McpManager;
  mcpNeedsAttention: boolean;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheReadInputTokens?: number;
    cacheWriteInputTokens?: number;
    latencyMs: number;
  };
};

function sessionModeValueColor(mode: string): string | undefined {
  const normalized = mode.trim().toLowerCase();
  if (normalized === "plan") {
    return "#FFA500";
  }
  if (normalized === "ask") {
    return "cyan";
  }
  return undefined;
}

/** Ink color for the reasoning effort/level token (labels stay `gray`). */
function reasoningEffortColor(effort: string): string {
  switch (effort.trim().toLowerCase()) {
    case "minimal":
      return "gray";
    case "low":
      return "cyan";
    case "medium":
      return "yellow";
    case "high":
      return "red";
    default:
      return "magenta";
  }
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
  currentModel,
  reasoningEffort,
  yoloOn,
  sessionMode,
  elapsedLabel,
  turnCount,
  totalTools,
  skillsFound,
  manager,
  mcpNeedsAttention,
  usage,
}: StatusBarProps) {
  // Cumulative billing meter. Usage is normalized to the additive shape
  // before accumulation (see src/core/models/usage.ts): `inputTokens` is only
  // the uncached portion and cached input (`cin`, read + write) is surfaced
  // separately — but only when the provider actually reports caching.
  const cacheInput =
    (usage.cacheReadInputTokens ?? 0) + (usage.cacheWriteInputTokens ?? 0);
  const tokensLabel = [
    `${formatTokenCount(usage.inputTokens)} in`,
    cacheInput > 0 ? `${formatTokenCount(cacheInput)} cin` : null,
    `${formatTokenCount(usage.outputTokens)} out`,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <Box marginTop={1} flexDirection="column">
      <Text>
        <Text color="gray">model: </Text>
        <Text bold>{currentModel}</Text>
        {reasoningEffort ? (
          <>
            <Text color="gray"> • effort: </Text>
            <Text color={reasoningEffortColor(reasoningEffort)}>
              {reasoningEffort}
            </Text>
          </>
        ) : null}
        <Text color="gray"> • mode: </Text>
        <Text color={sessionModeValueColor(sessionMode)}>{sessionMode}</Text>
        <Text color="gray"> • yolo: </Text>
        <Text color={yoloOn ? "red" : "green"}>{yoloOn ? "on" : "off"}</Text>
      </Text>
      <Text>
        <Text color="gray">status: </Text>
        <Text color={statusValueColor(status)}>{status}</Text>
        <Text color="gray">
          {" "}
          • turns: {turnCount} • tokens: {tokensLabel}
          {running ? ` • elapsed ${elapsedLabel}` : ""}
        </Text>
      </Text>
      <Text color="gray">
        {`mcp servers: ${manager.clients.size}`}
        {mcpNeedsAttention ? (
          <Text color="yellow"> (needs attention)</Text>
        ) : null}
        {` • tools: ${totalTools} • skills: ${skillsFound}`}
      </Text>
    </Box>
  );
}
