import { Box, Text } from "ink";
import type { ChatLine } from "../types.js";
import { lineColor } from "./shared.js";
import { MarkdownMessage } from "./markdown/MarkdownMessage.js";
import { ThinkingStatus } from "./ThinkingStatus.js";

type ChatMessageProps = { line: ChatLine };

export function ChatMessage({ line }: ChatMessageProps) {
  const roleName =
    line.role === "user"
      ? "You"
      : line.role === "assistant"
        ? "Assistant"
        : (line.title ?? "System");
  const isPendingAssistant = line.role === "assistant" && !line.done;
  const rawText =
    line.role === "assistant" ? line.content : line.content.trim();
  const text = rawText || (line.done ? "(empty)" : "");
  const shouldShowBody = Boolean(text) || !isPendingAssistant;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="row">
        <Text bold color={lineColor(line)}>
          {roleName}
        </Text>
        {isPendingAssistant ? <ThinkingStatus /> : null}
      </Box>
      {shouldShowBody ? (
        line.role === "assistant" ? (
          <MarkdownMessage streaming={isPendingAssistant}>
            {text}
          </MarkdownMessage>
        ) : (
          <Text color={line.role === "user" ? undefined : lineColor(line)}>
            {text}
          </Text>
        )
      ) : null}
    </Box>
  );
}
