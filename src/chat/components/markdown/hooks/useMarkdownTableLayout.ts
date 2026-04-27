import { useMemo } from "react";
import type { Token, Tokens } from "marked";
import { inlineToPlainText } from "../InlineRenderer.js";

const MIN_COLUMN_WIDTH = 3;
const MAX_ROW_LINES = 4;
const SAFETY_MARGIN = 4;

type TableLayout = {
  mode: "horizontal" | "vertical";
  lines: string[];
};

function displayWidth(value: string): number {
  return Array.from(value).length;
}

function longestWordWidth(value: string): number {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return MIN_COLUMN_WIDTH;
  }
  return Math.max(...words.map((word) => displayWidth(word)), MIN_COLUMN_WIDTH);
}

function wrapText(value: string, width: number): string[] {
  if (width <= 0) {
    return [value];
  }
  const normalized = value.replace(/\r\n/g, "\n").trimEnd();
  const sourceLines = normalized.length > 0 ? normalized.split("\n") : [""];
  const wrapped = sourceLines.flatMap((line) => {
    const words = line.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return [""];
    }
    const output: string[] = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (displayWidth(candidate) <= width) {
        current = candidate;
        continue;
      }
      if (current) {
        output.push(current);
      }
      if (displayWidth(word) <= width) {
        current = word;
        continue;
      }
      let remaining = word;
      while (displayWidth(remaining) > width) {
        output.push(Array.from(remaining).slice(0, width).join(""));
        remaining = Array.from(remaining).slice(width).join("");
      }
      current = remaining;
    }
    if (current) {
      output.push(current);
    }
    return output.length > 0 ? output : [""];
  });
  return wrapped.length > 0 ? wrapped : [""];
}

function padAligned(
  value: string,
  width: number,
  align: "left" | "center" | "right" | null | undefined,
): string {
  const padding = Math.max(0, width - displayWidth(value));
  if (align === "center") {
    const leftPad = Math.floor(padding / 2);
    return `${" ".repeat(leftPad)}${value}${" ".repeat(padding - leftPad)}`;
  }
  if (align === "right") {
    return `${" ".repeat(padding)}${value}`;
  }
  return `${value}${" ".repeat(padding)}`;
}

function rowToCells(row: Array<{ tokens?: Token[] }>): string[] {
  return row.map((cell) => inlineToPlainText(cell.tokens).trim());
}

function getVerticalLayout(
  header: string[],
  rows: string[][],
  terminalWidth: number,
): TableLayout {
  const lines: string[] = [];
  const separator = "─".repeat(Math.min(Math.max(terminalWidth - 1, 10), 40));
  rows.forEach((row, rowIndex) => {
    if (rowIndex > 0) {
      lines.push(separator);
    }
    row.forEach((cell, columnIndex) => {
      const label = header[columnIndex] || `Column ${columnIndex + 1}`;
      const compact = cell.replace(/\s+/g, " ").trim();
      const wrapped = wrapText(
        compact,
        Math.max(10, terminalWidth - displayWidth(label) - 3),
      );
      lines.push(`${label}: ${wrapped[0] ?? ""}`);
      for (let index = 1; index < wrapped.length; index += 1) {
        lines.push(`  ${wrapped[index]}`);
      }
    });
  });
  return { mode: "vertical", lines };
}

export function useMarkdownTableLayout(
  token: Tokens.Table,
  terminalWidth: number,
): TableLayout {
  return useMemo(() => {
    const header = rowToCells(token.header);
    const rows = token.rows.map((row) => rowToCells(row));
    const columnCount = header.length;
    if (columnCount === 0) {
      return { mode: "horizontal", lines: [] };
    }

    const minWidths = header.map((_, columnIndex) => {
      let max = longestWordWidth(header[columnIndex] ?? "");
      for (const row of rows) {
        max = Math.max(max, longestWordWidth(row[columnIndex] ?? ""));
      }
      return max;
    });
    const idealWidths = header.map((_, columnIndex) => {
      let max = Math.max(
        displayWidth(header[columnIndex] ?? ""),
        MIN_COLUMN_WIDTH,
      );
      for (const row of rows) {
        max = Math.max(max, displayWidth(row[columnIndex] ?? ""));
      }
      return max;
    });

    const borderOverhead = 1 + columnCount * 3;
    const availableWidth = Math.max(
      terminalWidth - borderOverhead - SAFETY_MARGIN,
      columnCount * MIN_COLUMN_WIDTH,
    );
    const totalMin = minWidths.reduce((sum, width) => sum + width, 0);
    const totalIdeal = idealWidths.reduce((sum, width) => sum + width, 0);

    let columnWidths: number[];
    if (totalIdeal <= availableWidth) {
      columnWidths = idealWidths;
    } else if (totalMin <= availableWidth) {
      const remaining = availableWidth - totalMin;
      const overflows = idealWidths.map(
        (ideal, index) => ideal - minWidths[index]!,
      );
      const totalOverflow = overflows.reduce(
        (sum, overflow) => sum + overflow,
        0,
      );
      columnWidths = minWidths.map((minWidth, index) => {
        if (totalOverflow === 0) {
          return minWidth;
        }
        const extra = Math.floor(
          (overflows[index]! / totalOverflow) * remaining,
        );
        return minWidth + extra;
      });
    } else {
      const ratio = availableWidth / totalMin;
      columnWidths = minWidths.map((width) =>
        Math.max(Math.floor(width * ratio), MIN_COLUMN_WIDTH),
      );
    }

    const maxRowLines = [header, ...rows]
      .map((row) =>
        row.reduce((max, cell, index) => {
          const wrapped = wrapText(cell, columnWidths[index]!);
          return Math.max(max, wrapped.length);
        }, 1),
      )
      .reduce((max, count) => Math.max(max, count), 1);

    if (maxRowLines > MAX_ROW_LINES) {
      return getVerticalLayout(header, rows, terminalWidth);
    }

    function border(type: "top" | "middle" | "bottom"): string {
      const chars = {
        top: ["┌", "─", "┬", "┐"],
        middle: ["├", "─", "┼", "┤"],
        bottom: ["└", "─", "┴", "┘"],
      }[type] as [string, string, string, string];
      const [left, line, cross, right] = chars;
      return `${left}${columnWidths
        .map((width) => line.repeat(width + 2))
        .join(cross)}${right}`;
    }

    function renderRow(
      row: string[],
      isHeader: boolean,
      align: Array<"left" | "center" | "right" | null | undefined>,
    ): string[] {
      const cells = row.map((cell, index) =>
        wrapText(cell, columnWidths[index]!),
      );
      const lineCount = Math.max(...cells.map((lines) => lines.length), 1);
      const output: string[] = [];
      for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
        let line = "│";
        for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
          const value = cells[columnIndex]?.[lineIndex] ?? "";
          const cellAlign = isHeader ? "center" : align[columnIndex];
          line += ` ${padAligned(value, columnWidths[columnIndex]!, cellAlign)} │`;
        }
        output.push(line);
      }
      return output;
    }

    const alignments = token.align ?? [];
    const lines: string[] = [
      border("top"),
      ...renderRow(header, true, alignments),
      border("middle"),
    ];
    rows.forEach((row, rowIndex) => {
      lines.push(...renderRow(row, false, alignments));
      if (rowIndex < rows.length - 1) {
        lines.push(border("middle"));
      }
    });
    lines.push(border("bottom"));
    return { mode: "horizontal", lines };
  }, [terminalWidth, token]);
}
