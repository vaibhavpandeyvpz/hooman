// Tolerant text replacement for the `edit_file` tool.
//
// The model rarely reproduces a target snippet byte-for-byte (indentation,
// trailing whitespace, and escaped characters drift). Rather than fail on the
// first mismatch, we try a small cascade of increasingly lenient strategies
// and stop at the first that yields a single unambiguous span in the file.
//
// Each strategy only ever *locates* an existing substring in `content` — it
// never rewrites text — so the caller can splice the exact matched span and
// keep byte-accurate diffs.

export type Replacer = (
  content: string,
  find: string,
) => Generator<string, void, unknown>;

/** Similarity floor (0..1) for accepting a block-anchor match. */
const BLOCK_ANCHOR_SIMILARITY_THRESHOLD = 0.65;

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0 || b.length === 0) {
    return Math.max(a.length, b.length);
  }

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + cost,
      );
    }
    [previous, current] = [current, previous];
  }

  return previous[b.length]!;
}

/** Byte offset of the start of line `lineIndex` (0-based) in `lines`. */
function offsetOfLine(lines: string[], lineIndex: number): number {
  let offset = 0;
  for (let i = 0; i < lineIndex; i += 1) {
    offset += lines[i]!.length + 1; // +1 for the split "\n"
  }
  return offset;
}

/** Substring spanning lines [startLine, endLine] inclusive. */
function joinLineRange(
  content: string,
  lines: string[],
  startLine: number,
  endLine: number,
): string {
  const start = offsetOfLine(lines, startLine);
  let end = start;
  for (let k = startLine; k <= endLine; k += 1) {
    end += lines[k]!.length;
    if (k < endLine) end += 1;
  }
  return content.substring(start, end);
}

function stripTrailingEmpty(lines: string[]): string[] {
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    return lines.slice(0, -1);
  }
  return lines;
}

/** Exact match. */
const exact: Replacer = function* (_content, find) {
  yield find;
};

/** Match line-by-line ignoring each line's leading/trailing whitespace. */
const lineTrimmed: Replacer = function* (content, find) {
  const contentLines = content.split("\n");
  const searchLines = stripTrailingEmpty(find.split("\n"));
  if (searchLines.length === 0) return;

  for (let i = 0; i <= contentLines.length - searchLines.length; i += 1) {
    let matches = true;
    for (let j = 0; j < searchLines.length; j += 1) {
      if (contentLines[i + j]!.trim() !== searchLines[j]!.trim()) {
        matches = false;
        break;
      }
    }
    if (matches) {
      yield joinLineRange(content, contentLines, i, i + searchLines.length - 1);
    }
  }
};

/** Strip the common leading indentation from both sides before comparing. */
const indentationFlexible: Replacer = function* (content, find) {
  const dedent = (text: string): string => {
    const lines = text.split("\n");
    const indents = lines
      .filter((line) => line.trim().length > 0)
      .map((line) => line.match(/^(\s*)/)![1]!.length);
    if (indents.length === 0) return text;
    const min = Math.min(...indents);
    return lines
      .map((line) => (line.trim().length === 0 ? line : line.slice(min)))
      .join("\n");
  };

  const normalizedFind = dedent(find);
  const contentLines = content.split("\n");
  const findLines = find.split("\n");

  for (let i = 0; i <= contentLines.length - findLines.length; i += 1) {
    const block = joinLineRange(
      content,
      contentLines,
      i,
      i + findLines.length - 1,
    );
    if (dedent(block) === normalizedFind) {
      yield block;
    }
  }
};

/** Collapse every run of whitespace to a single space before comparing. */
const whitespaceNormalized: Replacer = function* (content, find) {
  const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();
  const normalizedFind = collapse(find);
  if (normalizedFind.length === 0) return;

  const contentLines = content.split("\n");
  const findLines = find.split("\n");

  for (let i = 0; i <= contentLines.length - findLines.length; i += 1) {
    const block = joinLineRange(
      content,
      contentLines,
      i,
      i + findLines.length - 1,
    );
    if (collapse(block) === normalizedFind) {
      yield block;
    }
  }
};

/**
 * Anchor on the first and last (trimmed) lines of a multi-line block and
 * accept it when the interior is similar enough. Handles cases where the
 * model garbled a few middle lines but kept the boundaries intact.
 */
const blockAnchor: Replacer = function* (content, find) {
  const contentLines = content.split("\n");
  const searchLines = stripTrailingEmpty(find.split("\n"));
  if (searchLines.length < 3) return;

  const firstAnchor = searchLines[0]!.trim();
  const lastAnchor = searchLines[searchLines.length - 1]!.trim();
  const searchSize = searchLines.length;
  const maxDelta = Math.max(1, Math.floor(searchSize * 0.25));

  const candidates: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < contentLines.length; i += 1) {
    if (contentLines[i]!.trim() !== firstAnchor) continue;
    for (let j = i + 2; j < contentLines.length; j += 1) {
      if (contentLines[j]!.trim() === lastAnchor) {
        if (Math.abs(j - i + 1 - searchSize) <= maxDelta) {
          candidates.push({ start: i, end: j });
        }
        break; // only the nearest closing anchor
      }
    }
  }

  if (candidates.length === 0) return;

  const interiorSimilarity = (start: number, end: number): number => {
    const actualSize = end - start + 1;
    const checks = Math.min(searchSize - 2, actualSize - 2);
    if (checks <= 0) return 1;
    let total = 0;
    for (let j = 1; j <= checks; j += 1) {
      const original = contentLines[start + j]!.trim();
      const search = searchLines[j]!.trim();
      const maxLen = Math.max(original.length, search.length);
      if (maxLen === 0) continue;
      total += 1 - levenshtein(original, search) / maxLen;
    }
    return total / checks;
  };

  let best: { start: number; end: number } | null = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = interiorSimilarity(candidate.start, candidate.end);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  if (best && bestScore >= BLOCK_ANCHOR_SIMILARITY_THRESHOLD) {
    yield joinLineRange(content, contentLines, best.start, best.end);
  }
};

/** Interpret backslash escapes (\n, \t, \", ...) the model may have emitted. */
const escapeNormalized: Replacer = function* (content, find) {
  const unescape = (text: string): string =>
    text.replace(/\\([ntr'"`$\\\n])/g, (match, char: string) => {
      switch (char) {
        case "n":
          return "\n";
        case "t":
          return "\t";
        case "r":
          return "\r";
        case "'":
          return "'";
        case '"':
          return '"';
        case "`":
          return "`";
        case "$":
          return "$";
        case "\\":
        case "\n":
          return char === "\\" ? "\\" : "\n";
        default:
          return match;
      }
    });

  const unescapedFind = unescape(find);
  if (unescapedFind !== find && content.includes(unescapedFind)) {
    yield unescapedFind;
  }
};

const REPLACERS: Replacer[] = [
  exact,
  lineTrimmed,
  indentationFlexible,
  whitespaceNormalized,
  blockAnchor,
  escapeNormalized,
];

/**
 * Guard against a lenient strategy latching onto a span far larger than what
 * the model intended, which would silently delete unrelated code.
 */
function isDisproportionate(matched: string, find: string): boolean {
  const findLines = find.split("\n").length;
  const matchedLines = matched.split("\n").length;
  if (matchedLines >= Math.max(findLines + 3, findLines * 2)) return true;
  if (findLines === 1) return false;
  return (
    matched.trim().length >
    Math.max(find.trim().length + 500, find.trim().length * 4)
  );
}

export type ReplacementSpan = { index: number; text: string };

export class EditMatchError extends Error {}

/**
 * Locate the single span in `content` that `find` should replace.
 *
 * Tries each strategy in order and returns the first uniquely-locatable span.
 * Throws {@link EditMatchError} when nothing matches or when a match is
 * ambiguous, with a message aimed at helping the model recover.
 */
export function findReplacementSpan(
  content: string,
  find: string,
): ReplacementSpan {
  let sawAmbiguous = false;

  for (const replacer of REPLACERS) {
    for (const candidate of replacer(content, find)) {
      if (candidate.length === 0) continue;
      const index = content.indexOf(candidate);
      if (index === -1) continue;

      if (index !== content.lastIndexOf(candidate)) {
        sawAmbiguous = true;
        continue; // a later, stricter candidate may still be unique
      }

      if (isDisproportionate(candidate, find)) {
        throw new EditMatchError(
          "Refusing edit: the matched region is much larger than the requested text. " +
            "Re-read the file and provide the exact text to replace.",
        );
      }

      return { index, text: candidate };
    }
  }

  if (sawAmbiguous) {
    throw new EditMatchError(
      `Edit target is ambiguous (multiple matches). Add more surrounding context so it matches uniquely:\n${find}`,
    );
  }

  throw new EditMatchError(
    `Could not find edit target. It must match the file's text (whitespace and indentation may differ, but the content must be present):\n${find}`,
  );
}
