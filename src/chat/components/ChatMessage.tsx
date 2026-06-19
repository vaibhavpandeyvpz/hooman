import { Box, Text } from "ink";
import type { ChatLine } from "../types.js";
import { lineColor } from "./shared.js";
import { MarkdownMessage } from "./markdown/MarkdownMessage.js";
import { ThinkingStatus } from "./ThinkingStatus.js";

type ChatMessageProps = {
  line: ChatLine;
  assistantName?: string;
};

export function ChatMessage({
  line,
  assistantName = "Assistant",
}: ChatMessageProps) {
  const roleName =
    line.role === "user"
      ? "You"
      : line.role === "assistant"
        ? assistantName
        : (line.title ?? "System");
  const isPendingAssistant = line.role === "assistant" && !line.done;
  const rawText =
    line.role === "assistant" ? line.content : line.content.trim();
  const text = rawText;
  const shouldShowBody = Boolean(text) || isPendingAssistant;

  return (
    <Box flexDirection="column" marginBottom={1} width="100%">
      <Box flexDirection="row" width="100%">
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
          <Text
            color={line.role === "user" ? undefined : lineColor(line)}
            wrap="wrap"
          >
            {text}
          </Text>
        )
      ) : null}
    </Box>
  );
}
