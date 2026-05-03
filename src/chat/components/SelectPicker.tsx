import { Box, Text } from "ink";
import SelectInput from "ink-select-input";

export type SelectPickerItem = {
  label: string;
  value: string;
};

type SelectPickerProps = {
  title: string;
  items: SelectPickerItem[];
  onSelect: (value: string) => void;
};

export function SelectPicker({ title, items, onSelect }: SelectPickerProps) {
  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
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
