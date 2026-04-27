import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import type { PromptState } from "../types.js";

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
      <Text color="gray">{prompt.label}</Text>
      {prompt.note ? <Text color="gray">{prompt.note}</Text> : null}
      <Box marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text color="gray">{"> "}</Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={() => void onSubmit(value)}
          placeholder={prompt.placeholder ?? ""}
        />
      </Box>
      <Box marginTop={1}>
        <Text color="gray">enter: submit | esc: cancel | ctrl+c: exit</Text>
      </Box>
    </Box>
  );
}
