import { Box, Text, useWindowSize } from "ink";
import { wrapTextToLines } from "./shared.ts";

type ReasoningStripProps = {
  text: string;
  maxVisibleLines?: number;
};

export function ReasoningStrip({
  text,
  maxVisibleLines = 2,
}: ReasoningStripProps) {
  const { columns } = useWindowSize();
  const wrapped = wrapTextToLines(text, Math.max(20, columns - 6));
  const visibleLines = wrapped.slice(-maxVisibleLines);

  if (visibleLines.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column">
      {visibleLines.map((line, index) => (
        <Text key={index} color="gray" wrap="wrap">
          {line || " "}
        </Text>
      ))}
    </Box>
  );
}
