import { Box, Text } from "ink";
import { theme } from "../../core/theme.js";
import {
  formatCostUsd,
  formatTokenCount,
} from "../../core/utils/usage-format.js";
import type { DaemonSessionCard } from "../dashboard/types.js";
import {
  disposeReasonLabel,
  formatElapsed,
  originLabel,
  phaseLabel,
  sessionSuffix,
} from "./format.js";

function phaseColor(card: DaemonSessionCard): string {
  if (card.errorMessage) {
    return theme.error;
  }
  switch (card.phase) {
    case "waiting_slot":
    case "queued":
      return theme.warning;
    case "approval":
      return theme.secondary;
    default:
      return theme.success;
  }
}

function statusBadge(card: DaemonSessionCard): string {
  if (card.status === "in_progress") {
    return `\u25cf ${phaseLabel(card.phase)}`;
  }
  if (card.status === "disposed") {
    return `\u25cb ${disposeReasonLabel(card.disposeReason)}`;
  }
  return "idle";
}

export type CardProps = {
  card: DaemonSessionCard;
  now: number;
  width: number;
  selected: boolean;
};

export function Card({ card, now, width, selected }: CardProps) {
  const identity = card.title?.trim() || originLabel(card);
  const suffix = sessionSuffix(card.acpSessionId);
  const ageMs =
    card.status === "disposed" ? (card.disposedAt ?? now) : card.lastActiveAt;
  const usage = card.usage;
  const hasTokens = usage.inputTokens + usage.outputTokens > 0;
  const contextPct =
    usage.contextSize && usage.contextSize > 0
      ? Math.round(((usage.contextUsed ?? 0) / usage.contextSize) * 100)
      : undefined;

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="round"
      borderColor={selected ? theme.primary : theme.muted}
      paddingX={1}
      marginBottom={1}
    >
      <Text bold color={selected ? theme.primary : undefined} wrap="truncate">
        {identity}
        {suffix ? (
          <Text color={theme.muted}>
            {" \u00b7 "}
            {suffix}
          </Text>
        ) : null}
      </Text>
      <Text>
        <Text color={phaseColor(card)}>{statusBadge(card)}</Text>
        <Text color={theme.muted}>
          {" \u00b7 "}
          {formatElapsed(ageMs, now)}
        </Text>
        {card.queueDepth > 1 ? (
          <Text
            color={theme.warning}
          >{` \u00b7 q:${card.queueDepth - 1}`}</Text>
        ) : null}
      </Text>
      {card.errorMessage ? (
        <Text color={theme.error} wrap="truncate-end">
          {card.errorMessage}
        </Text>
      ) : card.toolLabel ? (
        <Text color={theme.secondary} wrap="truncate-end">
          tool: {card.toolLabel}
        </Text>
      ) : card.streamPreview ? (
        <Text wrap="truncate-end">{card.streamPreview}</Text>
      ) : card.promptPreview ? (
        <Text color={theme.muted} wrap="truncate-end">
          {card.promptPreview}
        </Text>
      ) : null}
      {(() => {
        const segments: string[] = [];
        if (hasTokens) {
          segments.push(
            `${formatTokenCount(usage.inputTokens)} in, ${formatTokenCount(usage.outputTokens)} out`,
          );
        }
        if (contextPct !== undefined) {
          segments.push(`ctx ${contextPct}%`);
        }
        if (usage.costUsd !== undefined) {
          segments.push(formatCostUsd(usage.costUsd));
        }
        return segments.length > 0 ? (
          <Text color={theme.muted} wrap="truncate-end">
            {segments.join(" \u00b7 ")}
          </Text>
        ) : null;
      })()}
    </Box>
  );
}
