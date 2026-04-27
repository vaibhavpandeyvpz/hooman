import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import type { ApprovalDecision } from "../types.js";

type ApprovalPromptProps = {
  onDecision: (decision: ApprovalDecision) => void;
};

export function ApprovalPrompt({ onDecision }: ApprovalPromptProps) {
  return (
    <Box flexDirection="column">
      <SelectInput<ApprovalDecision>
        items={[
          { label: "Allow", value: "allow" },
          { label: "Always", value: "always" },
          { label: "Deny", value: "reject" },
        ]}
        onSelect={(item) => onDecision(item.value)}
      />
      <Box marginTop={1}>
        <Text color="gray">up/down - choose - enter select</Text>
      </Box>
    </Box>
  );
}
