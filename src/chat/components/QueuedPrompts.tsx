import React from "react";
import { Box, Text, useStdout } from "ink";

type QueuedPromptsProps = {
  prompts: readonly { id: string; prompt: string }[];
};

const MIN_PROMPT_PREVIEW_CHARS = 16;
const MAX_PROMPT_PREVIEW_CHARS = 120;
const ELLIPSIS = "...";

function normalizePrompt(prompt: string): string {
  return prompt.replace(/\s+/g, " ").trim();
}

function truncatePrompt(prompt: string, maxChars: number): string {
  if (prompt.length <= maxChars) {
    return prompt;
  }
  if (maxChars <= ELLIPSIS.length) {
    return ELLIPSIS.slice(0, maxChars);
  }
  return `${prompt.slice(0, maxChars - ELLIPSIS.length)}${ELLIPSIS}`;
}

export function QueuedPrompts({
  prompts,
}: QueuedPromptsProps): React.JSX.Element | null {
  const { stdout } = useStdout();
  if (prompts.length === 0) {
    return null;
  }

  const columns = stdout?.columns ?? 80;
  const maxPromptChars = Math.max(
    MIN_PROMPT_PREVIEW_CHARS,
    Math.min(MAX_PROMPT_PREVIEW_CHARS, columns - 8),
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
    >
      <Text color="gray">
        queued {prompts.length === 1 ? "prompt" : "prompts"}
      </Text>
      {prompts.map((item) => {
        const preview = truncatePrompt(
          normalizePrompt(item.prompt),
          maxPromptChars,
        );
        return (
          <Text key={item.id} color="gray">
            {"\u25cb "}
            {preview}
          </Text>
        );
      })}
    </Box>
  );
}
