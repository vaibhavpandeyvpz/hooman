import { Box, Text } from "ink";

type SlashCommandItem = {
  name: string;
  description: string;
};

type SlashCommandsProps = {
  items: readonly SlashCommandItem[];
  highlightIndex: number;
};

export function SlashCommands({ items, highlightIndex }: SlashCommandsProps) {
  if (items.length === 0) {
    return null;
  }

  const safeIndex = Math.min(Math.max(0, highlightIndex), items.length - 1);

  return (
    <Box flexDirection="column" marginBottom={1}>
      {items.map((item, index) => {
        const selected = index === safeIndex;
        const cmd = `/${item.name}`;
        const desc = ` — ${item.description}`;
        return selected ? (
          <Text key={item.name} inverse>
            <Text bold>{cmd}</Text>
            <Text dimColor>{desc}</Text>
          </Text>
        ) : (
          <Text key={item.name} color="gray">
            <Text bold>{cmd}</Text>
            <Text dimColor>{desc}</Text>
          </Text>
        );
      })}
      <Text dimColor>↑↓ • tab complete • enter submit</Text>
    </Box>
  );
}
