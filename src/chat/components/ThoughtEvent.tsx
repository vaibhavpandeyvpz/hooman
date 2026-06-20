import { Box, Text } from "ink";
import { millify } from "millify";
import type { ChatLine } from "../types.js";
import { ReasoningStrip } from "./ReasoningStrip.js";
import { ThinkingStatus } from "./ThinkingStatus.js";

const TOKEN_MILLIFY_OPTS = {
  lowercase: true,
  precision: 1,
  space: false,
} as const;

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

function formatEstimatedTokens(tokens?: number): string {
  if (!tokens || !Number.isFinite(tokens) || tokens <= 0) {
    return "";
  }
  return ` • ~${millify(tokens, TOKEN_MILLIFY_OPTS)} tokens`;
}

type ThoughtEventProps = {
  line: ChatLine;
  assistantName?: string;
};

export function ThoughtEvent({
  line,
  assistantName = "Assistant",
}: ThoughtEventProps) {
  const durationMs =
    line.startedAt && line.finishedAt ? line.finishedAt - line.startedAt : 0;

  return (
    <Box flexDirection="column" width="100%">
      <Box flexDirection="row" width="100%">
        <Text bold color="blue">
          {assistantName}
        </Text>
        {line.done ? (
          <Text color="gray">
            {` thought for ${formatDuration(durationMs)}${formatEstimatedTokens(line.estimatedTokens)}`}
          </Text>
        ) : (
          <ThinkingStatus />
        )}
      </Box>
      {!line.done ? (
        <ReasoningStrip text={line.content} maxVisibleLines={2} />
      ) : null}
    </Box>
  );
}
