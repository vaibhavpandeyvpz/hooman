import { Box, Text, useWindowSize } from "ink";
import { wrapTextToLines } from "./shared.js";
import { theme } from "../../core/theme.js";

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
  const visibleLines = Number.isFinite(maxVisibleLines)
    ? wrapped.slice(-maxVisibleLines)
    : wrapped;

  if (visibleLines.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column">
      {visibleLines.map((line, index) => (
        <Text key={index} color={theme.muted} wrap="wrap">
          {line || " "}
        </Text>
      ))}
    </Box>
  );
}
