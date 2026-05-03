import { Box, Text } from "ink";
import { PromptInput } from "./PromptInput.js";
import type {
  PromptSubmission,
  SlashCommandMenuProps,
} from "./prompt-input/hooks/usePromptInputController.js";

type ComposerProps = {
  input: string;
  running: boolean;
  disabled: boolean;
  hint: string;
  onChange: (value: string) => void;
  onSubmit: (value: PromptSubmission) => void;
  slashMenu?: SlashCommandMenuProps | undefined;
};

export function Composer({
  input,
  running,
  disabled,
  hint,
  onChange,
  onSubmit,
  slashMenu,
}: ComposerProps) {
  return (
    <>
      <Box
        borderStyle="single"
        borderColor="gray"
        borderTop
        borderBottom
        borderLeft={false}
        borderRight={false}
        paddingY={0}
        paddingX={0}
      >
        <PromptInput
          value={input}
          onChange={onChange}
          onSubmit={onSubmit}
          slashMenu={slashMenu}
          placeholder={
            running
              ? "type a message\u2026 (queued after current turn)"
              : "type a message\u2026"
          }
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
