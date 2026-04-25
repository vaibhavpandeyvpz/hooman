import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInput } from "ink";
import type { InputState } from "./input-model.ts";
import {
  clampCursor,
  deleteBackward,
  deleteForward,
  deleteToLineEnd,
  deleteToLineStart,
  deleteWordBackward,
  deleteWordForward,
  insertText,
  moveCursorDown,
  moveCursorLeft,
  moveCursorLineEnd,
  moveCursorLineStart,
  moveCursorRight,
  moveCursorUp,
  moveCursorWordLeft,
  moveCursorWordRight,
} from "./input-model.ts";
import {
  expandPasteRefs,
  formatPasteRef,
  normalizePastedText,
  parsePasteRefs,
  shouldCollapsePaste,
} from "./paste.ts";
import { getPromptView, type PromptView } from "./render.ts";

type Args = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  focus: boolean;
  maxVisibleLines: number;
};

type Result = {
  view: PromptView;
};

export function usePromptInputController({
  value,
  onChange,
  onSubmit,
  focus,
  maxVisibleLines,
}: Args): Result {
  const [cursor, setCursor] = useState(value.length);
  const [col, setCol] = useState<number | null>(null);
  const [pastes, setPastes] = useState<Record<number, string>>({});

  const valueRef = useRef(value);
  const cursorRef = useRef(cursor);
  const pastesRef = useRef(pastes);
  const nextPasteIdRef = useRef(1);
  const chunksRef = useRef<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  useEffect(() => {
    pastesRef.current = pastes;
  }, [pastes]);

  useEffect(() => {
    setCursor((prev) => clampCursor(value, prev));
    setCol(null);
  }, [value]);

  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const ids = new Set(parsePasteRefs(value));
    setPastes((prev) => {
      const entries = Object.entries(prev);
      const hasOrphans = entries.some(([raw]) => {
        const id = Number.parseInt(raw, 10);
        return !ids.has(id);
      });
      if (!hasOrphans) {
        return prev;
      }
      const next: Record<number, string> = {};
      for (const [raw, text] of entries) {
        const id = Number.parseInt(raw, 10);
        if (ids.has(id)) {
          next[id] = text;
        }
      }
      return next;
    });
  }, [value]);

  const apply = useCallback(
    (next: InputState) => {
      const clamped = clampCursor(next.value, next.cursor);
      setCursor(clamped);
      setCol(null);
      if (next.value !== valueRef.current) {
        onChange(next.value);
      }
    },
    [onChange],
  );

  const getState = useCallback(
    (): InputState => ({
      value: valueRef.current,
      cursor: clampCursor(valueRef.current, cursorRef.current),
    }),
    [],
  );

  const submit = useCallback(() => {
    const expanded = expandPasteRefs(valueRef.current, pastesRef.current);
    onSubmit(expanded);
    setPastes({});
    nextPasteIdRef.current = 1;
    setCol(null);
  }, [onSubmit]);

  const applyPaste = useCallback(
    (raw: string) => {
      const state = getState();
      const text = normalizePastedText(raw);
      if (text.length === 0) {
        return;
      }
      const collapse = text.length > 1 && shouldCollapsePaste(text);
      if (collapse) {
        const id = nextPasteIdRef.current;
        nextPasteIdRef.current += 1;
        setPastes((prev) => ({
          ...prev,
          [id]: text,
        }));
        apply(insertText(state, formatPasteRef(id)));
        return;
      }
      apply(insertText(state, text));
    },
    [apply, getState],
  );

  const clearChunkTimer = useCallback(() => {
    if (!timerRef.current) {
      return;
    }
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const drainChunks = useCallback((): string | null => {
    if (chunksRef.current.length === 0) {
      return null;
    }
    clearChunkTimer();
    const raw = chunksRef.current.join("");
    chunksRef.current = [];
    return raw;
  }, [clearChunkTimer]);

  const flush = useCallback((): boolean => {
    const raw = drainChunks();
    if (!raw) {
      return false;
    }
    applyPaste(raw);
    return true;
  }, [applyPaste, drainChunks]);

  const queueChunk = useCallback(
    (chunk: string) => {
      clearChunkTimer();
      chunksRef.current.push(chunk);
      timerRef.current = setTimeout(() => {
        const raw = drainChunks();
        if (!raw) {
          return;
        }
        applyPaste(raw);
      }, 40);
    },
    [applyPaste, clearChunkTimer, drainChunks],
  );

  const ctrlMoves = useMemo(
    () =>
      ({
        a: moveCursorLineStart,
        b: moveCursorLeft,
        d: deleteForward,
        e: moveCursorLineEnd,
        f: moveCursorRight,
        k: deleteToLineEnd,
        u: deleteToLineStart,
        w: deleteWordBackward,
      }) as const,
    [],
  );

  const metaMoves = useMemo(
    () =>
      ({
        b: moveCursorWordLeft,
        f: moveCursorWordRight,
        d: deleteWordForward,
      }) as const,
    [],
  );

  useInput(
    (input, key) => {
      const state = getState();

      if (key.return) {
        if (flush()) {
          return;
        }
        const hasBackslash =
          !key.shift &&
          !key.meta &&
          state.cursor > 0 &&
          state.value[state.cursor - 1] === "\\";
        if (hasBackslash) {
          const withoutBackslash = deleteBackward(state);
          apply(insertText(withoutBackslash, "\n"));
          return;
        }
        if (key.shift || key.meta) {
          apply(insertText(state, "\n"));
          return;
        }
        submit();
        return;
      }

      if (key.leftArrow && (key.ctrl || key.meta || key.super)) {
        apply(moveCursorWordLeft(state));
        return;
      }
      if (key.rightArrow && (key.ctrl || key.meta || key.super)) {
        apply(moveCursorWordRight(state));
        return;
      }

      if (key.leftArrow) {
        apply(moveCursorLeft(state));
        return;
      }
      if (key.rightArrow) {
        apply(moveCursorRight(state));
        return;
      }
      if (key.home) {
        apply(moveCursorLineStart(state));
        return;
      }
      if (key.end) {
        apply(moveCursorLineEnd(state));
        return;
      }
      if (key.upArrow) {
        const moved = moveCursorUp(state, col ?? undefined);
        setCol(moved.targetColumn);
        setCursor(moved.state.cursor);
        return;
      }
      if (key.downArrow) {
        const moved = moveCursorDown(state, col ?? undefined);
        setCol(moved.targetColumn);
        setCursor(moved.state.cursor);
        return;
      }

      if (key.backspace) {
        if (key.ctrl || key.meta) {
          apply(deleteWordBackward(state));
        } else {
          apply(deleteBackward(state));
        }
        return;
      }
      if (key.delete) {
        if (key.meta) {
          apply(deleteToLineEnd(state));
        } else if (key.ctrl) {
          apply(deleteWordForward(state));
        } else {
          apply(deleteForward(state));
        }
        return;
      }

      if (key.ctrl) {
        const lower = input.toLowerCase();
        if (lower in ctrlMoves) {
          const op = ctrlMoves[lower as keyof typeof ctrlMoves];
          apply(op(state));
        }
        return;
      }

      if (key.meta) {
        const lower = input.toLowerCase();
        if (lower in metaMoves) {
          const op = metaMoves[lower as keyof typeof metaMoves];
          apply(op(state));
        }
        return;
      }

      if (key.tab) {
        apply(insertText(state, "    "));
        return;
      }

      if (input.length === 0 || key.escape) {
        return;
      }

      const isPasteChunk =
        input.length > 1 &&
        !key.ctrl &&
        !key.meta &&
        !key.tab &&
        !key.return &&
        !key.escape;
      if (isPasteChunk) {
        queueChunk(input);
        return;
      }

      applyPaste(input);
    },
    { isActive: focus },
  );

  const view = useMemo(
    () => getPromptView(value, cursor, maxVisibleLines),
    [cursor, maxVisibleLines, value],
  );

  return { view };
}
