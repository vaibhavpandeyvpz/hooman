import { Box, Text } from "ink";
import TextInput from "ink-text-input";

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
        <TextInput
          value={input}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder={running ? "Wait for current turn..." : "Type a message"}
          focus={!disabled}
        />
      </Box>

      <Box>
        <Text color="gray">{hint}</Text>
      </Box>
    </>
  );
}
