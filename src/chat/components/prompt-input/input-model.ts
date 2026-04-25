export type InputState = {
  value: string;
  cursor: number;
};

const PASTE_TOKEN_AT_END = /(^|\s)\[paste #\d+\]$/;
const WORD_CHAR = /[\p{L}\p{N}_]/u;

const graphemeSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

export function clampCursor(value: string, cursor: number): number {
  const n = Number.isFinite(cursor) ? Math.trunc(cursor) : 0;
  if (n < 0) {
    return 0;
  }
  if (n > value.length) {
    return value.length;
  }
  return n;
}

function replaceRange(
  value: string,
  start: number,
  end: number,
  replacement: string,
): string {
  return value.slice(0, start) + replacement + value.slice(end);
}

function deleteRange(
  state: InputState,
  start: number,
  end: number,
): InputState {
  const safeStart = clampCursor(state.value, start);
  const safeEnd = clampCursor(state.value, end);
  return {
    value: replaceRange(state.value, safeStart, safeEnd, ""),
    cursor: safeStart,
  };
}

function isWhitespace(char: string): boolean {
  return /\s/.test(char);
}

function isWordChar(char: string): boolean {
  return WORD_CHAR.test(char);
}

function moveToPrevGrapheme(text: string, at: number): number {
  const n = clampCursor(text, at);
  if (n <= 0) {
    return 0;
  }
  if (!graphemeSegmenter) {
    const cp = text.codePointAt(n - 1) ?? 0;
    return n - (cp > 0xffff ? 2 : 1);
  }
  let last = 0;
  for (const seg of graphemeSegmenter.segment(text)) {
    if (seg.index >= n) {
      break;
    }
    last = seg.index;
  }
  return last;
}

function moveToNextGrapheme(text: string, at: number): number {
  const n = clampCursor(text, at);
  if (n >= text.length) {
    return text.length;
  }
  if (!graphemeSegmenter) {
    const cp = text.codePointAt(n) ?? 0;
    return n + (cp > 0xffff ? 2 : 1);
  }
  for (const seg of graphemeSegmenter.segment(text)) {
    if (seg.index > n) {
      return seg.index;
    }
  }
  return text.length;
}

function graphemeLeftOfCursor(text: string, at: number): string {
  const p = moveToPrevGrapheme(text, at);
  const n = clampCursor(text, at);
  return text.slice(p, n);
}

function graphemeRightOfCursor(text: string, at: number): string {
  const n = clampCursor(text, at);
  const x = moveToNextGrapheme(text, n);
  return text.slice(n, x);
}

type CharKind = "space" | "word" | "other";

function getCharKind(char: string): CharKind {
  if (isWhitespace(char)) {
    return "space";
  }
  if (isWordChar(char)) {
    return "word";
  }
  return "other";
}

export function insertText(state: InputState, text: string): InputState {
  return {
    value: replaceRange(state.value, state.cursor, state.cursor, text),
    cursor: state.cursor + text.length,
  };
}

export function moveCursorLeft(state: InputState): InputState {
  return {
    ...state,
    cursor: moveToPrevGrapheme(state.value, state.cursor),
  };
}

export function moveCursorRight(state: InputState): InputState {
  return {
    ...state,
    cursor: moveToNextGrapheme(state.value, state.cursor),
  };
}

export function moveCursorWordLeft(state: InputState): InputState {
  let next = state.cursor;
  while (
    next > 0 &&
    getCharKind(graphemeLeftOfCursor(state.value, next)) === "space"
  ) {
    next = moveToPrevGrapheme(state.value, next);
  }
  if (next === 0) {
    return { ...state, cursor: 0 };
  }

  const kind = getCharKind(graphemeLeftOfCursor(state.value, next));
  while (
    next > 0 &&
    getCharKind(graphemeLeftOfCursor(state.value, next)) === kind
  ) {
    next = moveToPrevGrapheme(state.value, next);
  }
  return { ...state, cursor: next };
}

export function moveCursorWordRight(state: InputState): InputState {
  const { value } = state;
  let next = state.cursor;
  while (
    next < value.length &&
    getCharKind(graphemeRightOfCursor(value, next)) === "space"
  ) {
    next = moveToNextGrapheme(value, next);
  }
  if (next >= value.length) {
    return { ...state, cursor: value.length };
  }

  const kind = getCharKind(graphemeRightOfCursor(value, next));
  while (
    next < value.length &&
    getCharKind(graphemeRightOfCursor(value, next)) === kind
  ) {
    next = moveToNextGrapheme(value, next);
  }
  return { ...state, cursor: next };
}

export function findLineStart(value: string, cursor: number): number {
  const index = value.lastIndexOf("\n", Math.max(0, cursor - 1));
  return index === -1 ? 0 : index + 1;
}

export function findLineEnd(value: string, cursor: number): number {
  const index = value.indexOf("\n", cursor);
  return index === -1 ? value.length : index;
}

export function moveCursorLineStart(state: InputState): InputState {
  return { ...state, cursor: findLineStart(state.value, state.cursor) };
}

export function moveCursorLineEnd(state: InputState): InputState {
  return { ...state, cursor: findLineEnd(state.value, state.cursor) };
}

export function moveCursorUp(
  state: InputState,
  targetColumn?: number,
): { state: InputState; targetColumn: number } {
  const currentStart = findLineStart(state.value, state.cursor);
  if (currentStart === 0) {
    return { state, targetColumn: targetColumn ?? state.cursor };
  }
  const previousLineEnd = currentStart - 1;
  const previousLineStart = findLineStart(state.value, previousLineEnd);
  const currentColumn = state.cursor - currentStart;
  const preferred = targetColumn ?? currentColumn;
  const previousLength = previousLineEnd - previousLineStart;
  const nextCursor = previousLineStart + Math.min(preferred, previousLength);
  return { state: { ...state, cursor: nextCursor }, targetColumn: preferred };
}

export function moveCursorDown(
  state: InputState,
  targetColumn?: number,
): { state: InputState; targetColumn: number } {
  const currentEnd = findLineEnd(state.value, state.cursor);
  if (currentEnd >= state.value.length) {
    const currentStart = findLineStart(state.value, state.cursor);
    return {
      state,
      targetColumn: targetColumn ?? state.cursor - currentStart,
    };
  }
  const nextLineStart = currentEnd + 1;
  const nextLineEnd = findLineEnd(state.value, nextLineStart);
  const currentStart = findLineStart(state.value, state.cursor);
  const currentColumn = state.cursor - currentStart;
  const preferred = targetColumn ?? currentColumn;
  const nextLength = nextLineEnd - nextLineStart;
  const nextCursor = nextLineStart + Math.min(preferred, nextLength);
  return { state: { ...state, cursor: nextCursor }, targetColumn: preferred };
}

function findPasteTokenStart(value: string, cursor: number): number | null {
  if (cursor === 0) {
    return null;
  }
  const charAfter = value[cursor];
  if (charAfter !== undefined && !isWhitespace(charAfter)) {
    return null;
  }
  const before = value.slice(0, cursor);
  const match = before.match(PASTE_TOKEN_AT_END);
  if (!match || match.index === undefined) {
    return null;
  }
  return match.index + (match[1] ?? "").length;
}

export function deleteBackward(state: InputState): InputState {
  if (state.cursor === 0) {
    return state;
  }

  const tokenStart = findPasteTokenStart(state.value, state.cursor);
  if (tokenStart !== null) {
    return deleteRange(state, tokenStart, state.cursor);
  }

  const from = moveToPrevGrapheme(state.value, state.cursor);
  return deleteRange(state, from, state.cursor);
}

export function deleteForward(state: InputState): InputState {
  if (state.cursor >= state.value.length) {
    return state;
  }
  const to = moveToNextGrapheme(state.value, state.cursor);
  return deleteRange(state, state.cursor, to);
}

export function deleteWordBackward(state: InputState): InputState {
  const moved = moveCursorWordLeft(state);
  return deleteRange(state, moved.cursor, state.cursor);
}

export function deleteWordForward(state: InputState): InputState {
  const moved = moveCursorWordRight(state);
  return deleteRange(state, state.cursor, moved.cursor);
}

export function deleteToLineStart(state: InputState): InputState {
  const lineStart = findLineStart(state.value, state.cursor);
  return deleteRange(state, lineStart, state.cursor);
}

export function deleteToLineEnd(state: InputState): InputState {
  const lineEnd = findLineEnd(state.value, state.cursor);
  return deleteRange(state, state.cursor, lineEnd);
}
