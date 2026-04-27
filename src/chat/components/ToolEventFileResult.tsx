import { Box, Text } from "ink";
import type * as React from "react";
import type { ChatLine } from "../types.js";
import { compactInline, truncLine } from "./shared.js";
import { Spinner } from "./Spinner.js";
import {
  type FileToolResult,
  type StructuredPatchHunk,
} from "./file-tool-diff/file-tool-result.js";

const MAX_PATCH_LINES = 18;
const MAX_PATCH_WIDTH = 140;

type ToolEventFileResultProps = {
  line: ChatLine;
  result: FileToolResult;
};

export function ToolEventFileResult({
  line,
  result,
}: ToolEventFileResultProps): React.ReactNode {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="yellow" bold>
        Tool
      </Text>
      <Text>
        <Text bold>{result.toolName}</Text>
        <Text color="gray">: </Text>
        <Text>{compactInline(result.path, 160)}</Text>
      </Text>
      {line.phase === "running" ? (
        <Box flexDirection="row">
          <Spinner type="dots" color="yellow" />
          <Text color="gray"> running...</Text>
        </Box>
      ) : null}
      {line.phase === "done" ? <FileToolSummary result={result} /> : null}
      {result.structuredPatch.length > 0 ? (
        <PatchPreview hunks={result.structuredPatch} />
      ) : null}
    </Box>
  );
}

function FileToolSummary({ result }: { result: FileToolResult }) {
  if (result.kind === "write") {
    const operation = result.appended ? "Appended" : "Wrote";
    return (
      <Text color="gray">
        {operation}
        {result.bytesWritten === undefined
          ? ""
          : ` ${result.bytesWritten} bytes`}
      </Text>
    );
  }

  const mode = result.dryRun ? "Previewed" : "Applied";
  const edits =
    result.editsApplied === undefined
      ? "edits"
      : `${result.editsApplied} ${result.editsApplied === 1 ? "edit" : "edits"}`;
  const changed =
    result.changed === undefined
      ? ""
      : result.changed
        ? " changed"
        : " no changes";

  return (
    <Text color="gray">
      {mode} {edits}
      {changed}
    </Text>
  );
}

function PatchPreview({ hunks }: { hunks: StructuredPatchHunk[] }) {
  const lines = hunks.flatMap((hunk, index) => [
    ...(index > 0 ? ["..."] : []),
    `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    ...hunk.lines,
  ]);
  const visibleLines = lines.slice(0, MAX_PATCH_LINES);
  const hiddenLineCount = lines.length - visibleLines.length;

  return (
    <Box flexDirection="column" marginTop={1}>
      {visibleLines.map((line, index) => (
        <Text key={`${index}-${line}`} color={colorForPatchLine(line)}>
          {truncLine(line, MAX_PATCH_WIDTH)}
        </Text>
      ))}
      {hiddenLineCount > 0 ? (
        <Text color="gray">
          ... +{hiddenLineCount} {hiddenLineCount === 1 ? "line" : "lines"}
        </Text>
      ) : null}
    </Box>
  );
}

function colorForPatchLine(line: string): string {
  if (line.startsWith("+")) {
    return "green";
  }
  if (line.startsWith("-")) {
    return "red";
  }
  if (line.startsWith("@@") || line === "...") {
    return "gray";
  }
  return "white";
}
