import { Box, Text, useStdout } from "ink";
import type { ChatLine } from "../types.js";
import { ChatMessage } from "./ChatMessage.js";
import { EmptyChatBanner } from "./EmptyChatBanner.js";
import { compactInline, formatToolArgs, wrapTextToLines } from "./shared.js";
import { ThoughtEvent } from "./ThoughtEvent.js";
import { ToolEvent } from "./ToolEvent.js";

type TranscriptProps = {
  lines: ChatLine[];
  assistantName?: string;
  showEmptyBanner?: boolean;
  marginTop?: number;
  maxRows?: number;
  scrollOffset?: number;
};

type TranscriptLineProps = {
  line: ChatLine;
  assistantName?: string;
};

export function TranscriptLine({
  line,
  assistantName,
}: TranscriptLineProps) {
  return line.role === "tool" ? (
    <ToolEvent line={line} />
  ) : line.role === "thought" ? (
    <ThoughtEvent line={line} assistantName={assistantName} />
  ) : (
    <ChatMessage line={line} assistantName={assistantName} />
  );
}

function estimateWrappedRows(text: string, width: number): number {
  if (!text.trim()) {
    return 0;
  }

  return Math.max(1, wrapTextToLines(text, width).length);
}

function estimateLineRows(line: ChatLine, width: number): number {
  const usableWidth = Math.max(20, width - 6);
  let rows = 1;

  if (line.role === "thought") {
    rows += line.done
      ? 0
      : Math.min(2, estimateWrappedRows(line.content, usableWidth));
    return rows + 1;
  }

  if (line.role === "tool") {
    rows += 1;
    if (line.phase === "running") {
      rows += 1;
    }
    if (line.resultContent) {
      rows += estimateWrappedRows(
        compactInline(line.resultContent, 256),
        usableWidth,
      );
    }
    return rows + 1;
  }

  const body =
    line.role === "assistant" ? line.content : line.content.trim() || "";
  rows += estimateWrappedRows(body, usableWidth);
  return rows + 1;
}

function selectVisibleTail(
  lines: ChatLine[],
  maxRows: number,
  width: number,
  scrollOffset: number,
): {
  visibleLines: ChatLine[];
  clippedCount: number;
  hiddenLaterCount: number;
} {
  if (maxRows <= 0 || lines.length === 0) {
    return {
      visibleLines: [],
      clippedCount: lines.length,
      hiddenLaterCount: 0,
    };
  }

  const selected: ChatLine[] = [];
  let usedRows = 0;
  const lastIndex = Math.max(0, lines.length - 1 - scrollOffset);

  for (let index = lastIndex; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }

    const rows = estimateLineRows(line, width);
    if (selected.length > 0 && usedRows + rows > maxRows) {
      break;
    }
    if (selected.length === 0 && rows > maxRows) {
      selected.unshift(line);
      break;
    }

    selected.unshift(line);
    usedRows += rows;
  }

  return {
    visibleLines: selected,
    clippedCount:
      selected.length > 0
        ? Math.max(0, lines.indexOf(selected[0]!) )
        : lines.length,
    hiddenLaterCount: Math.max(0, lines.length - 1 - lastIndex),
  };
}

export function Transcript({
  lines,
  assistantName,
  showEmptyBanner = true,
  marginTop = 1,
  maxRows,
  scrollOffset = 0,
}: TranscriptProps) {
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;
  const isEmpty = lines.length === 0 && showEmptyBanner;
  const transcriptRows = Math.max(1, maxRows ?? 1);
  const { visibleLines, clippedCount, hiddenLaterCount } = selectVisibleTail(
    lines,
    transcriptRows,
    width,
    scrollOffset,
  );

  return (
    <Box
      flexDirection="column"
      marginTop={marginTop}
      width="100%"
      height={transcriptRows}
    >
      {isEmpty ? (
        <Box flexDirection="column" flexGrow={1} justifyContent="center">
          <EmptyChatBanner />
        </Box>
      ) : (
        <>
          <Box flexGrow={1} flexShrink={1} />
          <Box flexDirection="column" flexShrink={0}>
            {clippedCount > 0 ? (
              <Text color="gray">
                {`… ${clippedCount} earlier ${clippedCount === 1 ? "entry" : "entries"} • pgup/pgdn scroll`}
              </Text>
            ) : null}
            {visibleLines.map((line) => (
              <TranscriptLine
                key={line.id}
                line={line}
                assistantName={assistantName}
              />
            ))}
            {hiddenLaterCount > 0 ? (
              <Text color="gray">
                {`… ${hiddenLaterCount} later ${hiddenLaterCount === 1 ? "entry" : "entries"} • end to jump back`}
              </Text>
            ) : null}
          </Box>
        </>
      )}
    </Box>
  );
}
