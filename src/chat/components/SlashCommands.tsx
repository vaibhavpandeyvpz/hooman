import { Box, Text } from "ink";

type SlashCommandItem = {
  name: string;
  description: string;
};

type SlashCommandsProps = {
  items: readonly SlashCommandItem[];
};

export function SlashCommands({ items }: SlashCommandsProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {items.map((item) => (
        <Text key={item.name} color="gray">
          /{item.name} - {item.description}
        </Text>
      ))}
    </Box>
  );
}
