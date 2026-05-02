import { Box, Text } from "ink";
import SelectInput from "ink-select-input";

type ModelPickerItem = {
  label: string;
  value: string;
};

type ModelPickerProps = {
  items: ModelPickerItem[];
  onSelect: (value: string) => void;
};

export function ModelPicker({ items, onSelect }: ModelPickerProps) {
  return (
    <Box flexDirection="column">
      <Text bold>Choose Model</Text>
      <SelectInput<string>
        items={items}
        onSelect={(item) => onSelect(item.value)}
      />
      <Box marginTop={1}>
        <Text color="gray">up/down choose • enter select • esc cancel</Text>
      </Box>
    </Box>
  );
}
