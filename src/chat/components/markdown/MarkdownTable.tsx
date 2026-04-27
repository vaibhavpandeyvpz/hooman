import { Box, Text, useWindowSize } from "ink";
import type { Tokens } from "marked";
import { useMarkdownTableLayout } from "./hooks/useMarkdownTableLayout.js";

type MarkdownTableProps = {
  token: Tokens.Table;
};

export function MarkdownTable({ token }: MarkdownTableProps) {
  const { columns } = useWindowSize();
  const layout = useMarkdownTableLayout(token, columns);
  if (layout.lines.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      {layout.lines.map((line, index) => (
        <Text key={index}>{line}</Text>
      ))}
    </Box>
  );
}
