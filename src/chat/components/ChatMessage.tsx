import { Box, Text } from "ink";
import type { ChatLine } from "../types.ts";
import { lineColor } from "./shared.ts";
import { ReasoningStrip } from "./ReasoningStrip.tsx";
import { ThinkingStatus } from "./ThinkingStatus.tsx";

type ChatMessageProps = {
  line: ChatLine;
  liveReasoning?: string;
};

export function ChatMessage({ line, liveReasoning = "" }: ChatMessageProps) {
  const roleName =
    line.role === "user"
      ? "You"
      : line.role === "assistant"
        ? "Assistant"
        : (line.title ?? "System");
  const isPendingAssistant = line.role === "assistant" && !line.done;
  const text = line.content.trim() || (line.done ? "(empty)" : "");
  const shouldShowBody = Boolean(text) || !isPendingAssistant;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="row">
        <Text bold color={lineColor(line)}>
          {roleName}
        </Text>
        {isPendingAssistant ? <ThinkingStatus /> : null}
      </Box>
      {isPendingAssistant && liveReasoning ? (
        <ReasoningStrip text={liveReasoning} maxVisibleLines={2} />
      ) : null}
      {shouldShowBody ? (
        <Text
          color={
            line.role === "user" || line.role === "assistant"
              ? undefined
              : lineColor(line)
          }
        >
          {text}
        </Text>
      ) : null}
    </Box>
  );
}
