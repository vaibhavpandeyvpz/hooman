import React from "react";
import { Box, Text, useStdout } from "ink";
import type { PromptSubmission } from "./prompt-input/hooks/usePromptInputController.ts";

type QueuedPromptsProps = {
  prompts: readonly { id: string; prompt: PromptSubmission }[];
};

const MIN_PROMPT_PREVIEW_CHARS = 16;
const MAX_PROMPT_PREVIEW_CHARS = 120;
const ELLIPSIS = "...";

function normalizePrompt(prompt: string): string {
  return prompt.replace(/\s+/g, " ").trim();
}

function promptPreview(prompt: PromptSubmission): string {
  const text = normalizePrompt(prompt.text);
  if (prompt.attachments.length === 0) {
    return text;
  }
  const suffix = `${prompt.attachments.length} attachment${
    prompt.attachments.length === 1 ? "" : "s"
  }`;
  return text ? `${text} (${suffix})` : suffix;
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
          promptPreview(item.prompt),
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
