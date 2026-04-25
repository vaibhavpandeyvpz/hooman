import { Box, Text } from "ink";
import { PromptInput } from "./PromptInput.tsx";

type ComposerProps = {
  input: string;
  running: boolean;
  disabled: boolean;
  hint: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
};

export function Composer({
  input,
  running,
  disabled,
  hint,
  onChange,
  onSubmit,
}: ComposerProps) {
  return (
    <>
      <Box borderStyle="round" borderColor="gray" paddingX={1}>
        <Text color="gray">{"> "}</Text>
        <PromptInput
          value={input}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder={running ? "Wait for current turn..." : "Type a message"}
          focus={!disabled}
          maxVisibleLines={4}
        />
      </Box>

      <Box>
        <Text color="gray">{hint}</Text>
      </Box>
    </>
  );
}
