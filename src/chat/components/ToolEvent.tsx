import { Box, Text } from "ink";
import type { ChatLine } from "../types.ts";
import { useFileToolResult } from "./file-tool-diff/file-tool-result.ts";
import { compactInline, formatToolArgs } from "./shared.ts";
import { Spinner } from "./Spinner.tsx";
import { ToolEventFileResult } from "./ToolEventFileResult.tsx";

type ToolEventProps = {
  line: ChatLine;
};

export function ToolEvent({ line }: ToolEventProps) {
  const fileToolResult = useFileToolResult(line);
  if (fileToolResult) {
    return <ToolEventFileResult line={line} result={fileToolResult} />;
  }

  const args = formatToolArgs(line.content)[0] ?? "";
  const result = line.resultContent
    ? compactInline(line.resultContent, 256)
    : null;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="yellow" bold>
        Tool
      </Text>
      <Text>
        <Text bold>{line.toolName ?? "unknown"}</Text>
        <Text>{args ? `: ${args}` : ""}</Text>
      </Text>
      {line.phase === "running" ? (
        <Box flexDirection="row">
          <Spinner type="dots" color="yellow" />
          <Text color="gray"> running...</Text>
        </Box>
      ) : null}
      {result ? <Text>{result}</Text> : null}
    </Box>
  );
}
