import { Box, Text } from "ink";
import type { ChatLine } from "../types.js";
import { useFileToolResult } from "./file-tool-diff/file-tool-result.js";
import { compactInline, formatToolArgs } from "./shared.js";
import { Spinner } from "./Spinner.js";
import { ToolEventFileResult } from "./ToolEventFileResult.js";
import { theme } from "../../core/theme.js";

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
    <Box flexDirection="column" width="100%">
      <Text color={theme.warning} bold>
        Tool
      </Text>
      <Text>
        <Text bold>{line.toolName ?? "unknown"}</Text>
        <Text>{args ? `: ${args}` : ""}</Text>
      </Text>
      {line.phase === "running" ? (
        <Box flexDirection="row">
          <Spinner type="dots" color={theme.warning} />
          <Text color={theme.muted}> running...</Text>
        </Box>
      ) : null}
      {result ? <Text color={theme.muted}>{result}</Text> : null}
    </Box>
  );
}
