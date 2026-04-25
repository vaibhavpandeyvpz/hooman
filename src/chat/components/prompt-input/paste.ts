export const PASTE_THRESHOLD_CHARS = 800;
export const PASTE_THRESHOLD_LINE_BREAKS = 2;

const ANSI_ESCAPE_PATTERN =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const PASTE_REF_PATTERN = /\[paste #(\d+)\]/g;

function toPasteId(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function normalizePastedText(input: string): string {
  return input
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replaceAll("\t", "    ");
}

export function countLineBreaks(text: string): number {
  let count = 0;
  for (const ch of text) {
    if (ch === "\n") {
      count += 1;
    }
  }
  return count;
}

export function formatPasteRef(id: number): string {
  return `[paste #${id}]`;
}

export function parsePasteRefs(input: string): number[] {
  const ids: number[] = [];
  for (const match of input.matchAll(PASTE_REF_PATTERN)) {
    const id = toPasteId(match[1]);
    if (id !== null) {
      ids.push(id);
    }
  }
  return ids;
}

export function shouldCollapsePaste(
  text: string,
  maxChars = PASTE_THRESHOLD_CHARS,
  maxLineBreaks = PASTE_THRESHOLD_LINE_BREAKS,
): boolean {
  return text.length > maxChars || countLineBreaks(text) > maxLineBreaks;
}

export function expandPasteRefs(
  input: string,
  pastedContents: Readonly<Record<number, string>>,
): string {
  return input.replace(PASTE_REF_PATTERN, (match, rawId: string) => {
    const id = toPasteId(rawId);
    if (id === null) {
      return match;
    }
    return pastedContents[id] ?? match;
  });
}
