import { clampCursor } from "./input-model.ts";

const graphemeSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

type CursorPos = {
  line: number;
  col: number;
};

export type PromptView = {
  lineOffset: number;
  visibleLines: string[];
  cursorLineInView: number;
  cursorCol: number;
  showPlaceholder: boolean;
};

function getCursorPos(value: string, cursor: number): CursorPos {
  const safe = clampCursor(value, cursor);
  const text = value.slice(0, safe);
  const line = text.split("\n").length - 1;
  const lineStart = text.lastIndexOf("\n");
  return {
    line,
    col: lineStart === -1 ? text.length : text.length - lineStart - 1,
  };
}

function nextBoundary(text: string, at: number): number {
  const from = Math.max(0, Math.min(at, text.length));
  if (from >= text.length) {
    return text.length;
  }
  if (!graphemeSegmenter) {
    const cp = text.codePointAt(from) ?? 0;
    return from + (cp > 0xffff ? 2 : 1);
  }
  for (const seg of graphemeSegmenter.segment(text)) {
    if (seg.index > from) {
      return seg.index;
    }
  }
  return text.length;
}

export function splitLineAtCursor(
  line: string,
  col: number,
): {
  left: string;
  at: string;
  right: string;
} {
  const start = Math.max(0, Math.min(col, line.length));
  const end = nextBoundary(line, start);
  const at = start < line.length ? line.slice(start, end) : " ";
  return {
    left: line.slice(0, start),
    at,
    right: start < line.length ? line.slice(end) : "",
  };
}

export function getPromptView(
  value: string,
  cursor: number,
  maxVisibleLines: number,
): PromptView {
  const pos = getCursorPos(value, cursor);
  const lines = value.length === 0 ? [""] : value.split("\n");
  const start = Math.max(0, pos.line - maxVisibleLines + 1);
  const end = start + maxVisibleLines;
  return {
    lineOffset: start,
    visibleLines: lines.slice(start, end),
    cursorLineInView: pos.line - start,
    cursorCol: pos.col,
    showPlaceholder: value.length === 0,
  };
}
