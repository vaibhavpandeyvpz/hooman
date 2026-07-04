export type DiffLineKind = "ctx" | "add" | "del";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

export interface ComputedDiff {
  lines: DiffLine[];
  adds: number;
  removes: number;
}

const CONTEXT_LINES = 3;

/**
 * Compact single-hunk line diff: trim the common prefix/suffix and show the
 * changed region with a little context. Mirrors the agent's own patch
 * builder — good enough for the transcript preview; the full split diff is
 * one click away (native VS Code diff editor).
 */
export function computeDiffLines(
  oldText: string | null,
  newText: string,
): ComputedDiff {
  const oldLines =
    oldText === null || oldText === "" ? [] : String(oldText).split("\n");
  const newLines = newText === "" ? [] : String(newText).split("\n");
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix++;
  }
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (
    oldEnd > prefix &&
    newEnd > prefix &&
    oldLines[oldEnd - 1] === newLines[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }
  const removed = oldLines.slice(prefix, oldEnd);
  const added = newLines.slice(prefix, newEnd);
  const before = oldLines.slice(Math.max(0, prefix - CONTEXT_LINES), prefix);
  const after = oldLines.slice(
    oldEnd,
    Math.min(oldLines.length, oldEnd + CONTEXT_LINES),
  );
  const lines: DiffLine[] = [
    ...before.map((text) => ({ kind: "ctx" as const, text })),
    ...removed.map((text) => ({ kind: "del" as const, text })),
    ...added.map((text) => ({ kind: "add" as const, text })),
    ...after.map((text) => ({ kind: "ctx" as const, text })),
  ];
  return { lines, adds: added.length, removes: removed.length };
}

export function baseName(fsPath: string): string {
  const parts = String(fsPath).split(/[\\/]/);
  return parts[parts.length - 1] || fsPath;
}
