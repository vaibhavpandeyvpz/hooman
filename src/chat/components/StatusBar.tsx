import { Fragment, type ReactNode } from "react";
import { Box, Text } from "ink";
import type { Manager as McpManager } from "../../core/mcp/index.js";
import { theme } from "../../core/theme.js";
import {
  formatCostUsd,
  formatTokenCount,
} from "../../core/utils/usage-format.js";

/** Color the context-utilization percentage as it approaches the window limit. */
function contextUsageColor(ratio: number): string {
  if (ratio >= 0.9) {
    return theme.error;
  }
  if (ratio >= 0.7) {
    return theme.warning;
  }
  return theme.success;
}

type StatusBarProps = {
  running: boolean;
  currentModel: string;
  reasoningEffort?: string;
  yoloOn: boolean;
  sessionMode: string;
  elapsedLabel: string;
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
    tokensPerSecond?: number;
  };
  /** Context-window utilization; only set when the window size was resolved. */
  contextUsage?: { used: number; size: number };
  /** Cumulative session cost in USD; only set when pricing was resolved. */
  costUsd?: number;
};

function sessionModeValueColor(mode: string): string | undefined {
  const normalized = mode.trim().toLowerCase();
  if (normalized === "plan") {
    return theme.warning;
  }
  if (normalized === "ask") {
    return theme.primary;
  }
  if (normalized === "design") {
    return theme.secondary;
  }
  return undefined;
}

/** Ink color for the reasoning effort/level token (labels stay muted). */
function reasoningEffortColor(effort: string): string {
  switch (effort.trim().toLowerCase()) {
    case "minimal":
      return theme.muted;
    case "low":
      return theme.primary;
    case "medium":
      return theme.warning;
    case "high":
      return theme.error;
    default:
      return theme.secondary;
  }
}

export function StatusBar({
  running,
  currentModel,
  reasoningEffort,
  yoloOn,
  sessionMode,
  elapsedLabel,
  totalTools,
  skillsFound,
  manager,
  mcpNeedsAttention,
  usage,
  contextUsage,
  costUsd,
}: StatusBarProps) {
  // Latest-request token meter. Usage is normalized to the additive shape
  // (see src/core/models/usage.ts): `inputTokens` is only the uncached portion,
  // with cached input (read + write) folded into the same segment as
  // `uncached/cached in` — the cached part shows only when the provider
  // actually reports caching.
  const cacheInput =
    (usage.cacheReadInputTokens ?? 0) + (usage.cacheWriteInputTokens ?? 0);
  const inputLabel =
    cacheInput > 0
      ? `${formatTokenCount(usage.inputTokens)}/${formatTokenCount(cacheInput)} in`
      : `${formatTokenCount(usage.inputTokens)} in`;
  const tokensLabel = [
    inputLabel,
    `${formatTokenCount(usage.outputTokens)} out`,
    ...(usage.tokensPerSecond && usage.tokensPerSecond > 0
      ? [`${formatTokenCount(usage.tokensPerSecond)} tok/s`]
      : []),
  ].join(", ");
  const hasTokens = usage.inputTokens + cacheInput + usage.outputTokens > 0;
  // Context-window utilization + session cost, resolved from the model's
  // `metadata` config / the models.dev catalog. Hidden when unresolved.
  const contextRatio =
    contextUsage && contextUsage.size > 0
      ? contextUsage.used / contextUsage.size
      : null;
  // Middle row: context • tokens • cost (each hidden until it has data).
  // The row collapses when empty.
  const usageSegments: ReactNode[] = [];
  if (contextUsage && contextRatio !== null) {
    usageSegments.push(
      <Fragment>
        <Text color={theme.muted}>context: </Text>
        <Text color={contextUsageColor(contextRatio)}>
          {Math.min(100, Math.round(contextRatio * 100))}%
        </Text>
        <Text color={theme.muted}>
          {" "}
          ({formatTokenCount(contextUsage.used)}/
          {formatTokenCount(contextUsage.size)})
        </Text>
      </Fragment>,
    );
  }
  if (hasTokens) {
    usageSegments.push(<Text color={theme.muted}>tokens: {tokensLabel}</Text>);
  }
  if (costUsd !== undefined) {
    usageSegments.push(
      <Text color={theme.muted}>cost: {formatCostUsd(costUsd)}</Text>,
    );
  }
  return (
    <Box marginTop={1} flexDirection="column">
      <Text>
        <Text color={theme.muted}>model: </Text>
        <Text bold>{currentModel}</Text>
        {reasoningEffort ? (
          <>
            <Text color={theme.muted}> • effort: </Text>
            <Text color={reasoningEffortColor(reasoningEffort)}>
              {reasoningEffort}
            </Text>
          </>
        ) : null}
        <Text color={theme.muted}> • mode: </Text>
        <Text color={sessionModeValueColor(sessionMode)}>{sessionMode}</Text>
        <Text color={theme.muted}> • yolo: </Text>
        <Text color={yoloOn ? theme.error : theme.success}>
          {yoloOn ? "on" : "off"}
        </Text>
      </Text>
      {usageSegments.length > 0 ? (
        <Text>
          {usageSegments.map((segment, index) => (
            <Fragment key={index}>
              {index > 0 ? <Text color={theme.muted}> • </Text> : null}
              {segment}
            </Fragment>
          ))}
        </Text>
      ) : null}
      <Text color={theme.muted}>
        {`mcp servers: ${manager.clients.size}`}
        {mcpNeedsAttention ? (
          <Text color={theme.warning}> (needs attention)</Text>
        ) : null}
        {` • tools: ${totalTools} • skills: ${skillsFound}`}
        {running ? ` • elapsed ${elapsedLabel}` : ""}
      </Text>
    </Box>
  );
}
