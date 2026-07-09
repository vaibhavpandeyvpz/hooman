import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import type { PromptState } from "../types.js";
import { theme } from "../../core/theme.js";

type PromptFormProps = {
  prompt: PromptState;
  onSubmit: (value: string) => void | Promise<void>;
};

export function PromptForm({
  prompt,
  onSubmit,
}: PromptFormProps): React.JSX.Element {
  const [value, setValue] = useState(prompt.initialValue ?? "");

  useEffect(() => {
    setValue(prompt.initialValue ?? "");
  }, [prompt.initialValue, prompt.title, prompt.label]);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>{prompt.title}</Text>
      <Text color={theme.muted}>{prompt.label}</Text>
      {prompt.note ? <Text color={theme.muted}>{prompt.note}</Text> : null}
      <Box
        marginTop={1}
        borderStyle="round"
        borderColor={theme.primary}
        paddingX={1}
      >
        <Text color={theme.muted}>{"> "}</Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={() => void onSubmit(value)}
          placeholder={prompt.placeholder ?? ""}
        />
      </Box>
      <Box marginTop={1}>
        <Text color={theme.muted}>
          enter: submit | esc: cancel | ctrl+c: exit
        </Text>
      </Box>
    </Box>
  );
}
