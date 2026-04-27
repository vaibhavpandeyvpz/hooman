import type { ChatLine } from "../types.js";

export function lineColor(line: ChatLine): string {
  switch (line.role) {
    case "user":
      return "cyan";
    case "assistant":
      return "blue";
    case "tool":
      return "gray";
    case "system":
      return "red";
    default:
      return "gray";
  }
}

export function truncLine(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}

export function compactInline(value: string, max = 120): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return truncLine(normalized, max);
}

export function formatToolArgs(raw: string): string[] {
  if (!raw) {
    return [];
  }
  try {
    const obj = JSON.parse(raw);
    if (typeof obj !== "object" || obj === null) {
      return [compactInline(String(obj), 120)];
    }
    return [compactInline(JSON.stringify(obj, null, 2), 120)];
  } catch {
    return [compactInline(raw, 120)];
  }
}

export function wrapTextToLines(text: string, width: number): string[] {
  const maxWidth = Math.max(20, width);
  return text.split("\n").flatMap((paragraph) => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return [""];
    }
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) {
        lines.push(current);
      }
      current = word.length > maxWidth ? word.slice(0, maxWidth - 1) : word;
    }
    if (current) {
      lines.push(current);
    }
    return lines;
  });
}
