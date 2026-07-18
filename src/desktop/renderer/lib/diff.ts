export type DiffLine = {
  kind: "add" | "del" | "ctx";
  oldLine: number | null;
  newLine: number | null;
  text: string;
};

/**
 * Small LCS-based line diff — no dependency, good enough for a compact
 * inline preview (not a full merge/patch tool). O(n*m); fine for the
 * file-sized diffs a single tool call produces.
 */
export function computeDiffLines(
  oldText: string | null,
  newText: string,
): { lines: DiffLine[]; adds: number; removes: number } {
  const oldLines = oldText === null ? [] : oldText.split("\n");
  const newLines = newText.split("\n");

  if (oldText === null) {
    return {
      lines: newLines.map((text, i) => ({
        kind: "add",
        oldLine: null,
        newLine: i + 1,
        text,
      })),
      adds: newLines.length,
      removes: 0,
    };
  }

  const n = oldLines.length;
  const m = newLines.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] =
        oldLines[i] === newLines[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldLine = 1;
  let newLine = 1;
  let adds = 0;
  let removes = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      lines.push({
        kind: "ctx",
        oldLine: oldLine++,
        newLine: newLine++,
        text: oldLines[i]!,
      });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      lines.push({
        kind: "del",
        oldLine: oldLine++,
        newLine: null,
        text: oldLines[i]!,
      });
      removes++;
      i++;
    } else {
      lines.push({
        kind: "add",
        oldLine: null,
        newLine: newLine++,
        text: newLines[j]!,
      });
      adds++;
      j++;
    }
  }
  while (i < n) {
    lines.push({
      kind: "del",
      oldLine: oldLine++,
      newLine: null,
      text: oldLines[i]!,
    });
    removes++;
    i++;
  }
  while (j < m) {
    lines.push({
      kind: "add",
      oldLine: null,
      newLine: newLine++,
      text: newLines[j]!,
    });
    adds++;
    j++;
  }
  return { lines, adds, removes };
}

export function baseName(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}
