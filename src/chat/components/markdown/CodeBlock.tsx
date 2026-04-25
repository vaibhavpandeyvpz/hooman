import { createRequire } from "node:module";
import type React from "react";
import { useMemo } from "react";
import { Box, Text } from "ink";
import { highlight, supportsLanguage } from "cli-highlight";

type CodeBlockProps = {
  code: string;
  language?: string;
  streaming?: boolean;
};

type InkAnsiComponent = React.ComponentType<{
  children?: React.ReactNode;
}>;

const localRequire = createRequire(import.meta.url);
const ANSI_RE = /\u001b\[[0-9;]*m/g;
let cachedInkAnsi: InkAnsiComponent | null | undefined;

function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, "");
}

function getInkAnsi(): InkAnsiComponent | null {
  if (cachedInkAnsi !== undefined) {
    return cachedInkAnsi;
  }
  try {
    const moduleValue = localRequire("ink-ansi") as
      | InkAnsiComponent
      | { default?: InkAnsiComponent };
    cachedInkAnsi =
      typeof moduleValue === "function"
        ? moduleValue
        : (moduleValue.default ?? null);
  } catch {
    cachedInkAnsi = null;
  }
  return cachedInkAnsi;
}

function renderCodeLines(lines: string[], color?: string) {
  return lines.map((line, index) => (
    <Text key={index} color={color}>
      {line || " "}
    </Text>
  ));
}

export function CodeBlock({
  code,
  language,
  streaming = false,
}: CodeBlockProps) {
  const trimmedLanguage = language?.trim() || undefined;
  const normalizedCode = useMemo(() => code.replace(/\r\n/g, "\n"), [code]);
  const plainLines = useMemo(
    () => normalizedCode.split("\n"),
    [normalizedCode],
  );
  const highlightedLines = useMemo(() => {
    if (streaming || !trimmedLanguage || !supportsLanguage(trimmedLanguage)) {
      return null;
    }
    try {
      return highlight(normalizedCode, {
        language: trimmedLanguage,
        ignoreIllegals: true,
      }).split("\n");
    } catch {
      return null;
    }
  }, [normalizedCode, streaming, trimmedLanguage]);

  if (highlightedLines) {
    const InkAnsiText = getInkAnsi();
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color="gray">{`\`\`\`${trimmedLanguage}`}</Text>
        {highlightedLines.map((line, index) =>
          InkAnsiText ? (
            <InkAnsiText key={index}>{line || " "}</InkAnsiText>
          ) : (
            <Text key={index}>{stripAnsi(line) || " "}</Text>
          ),
        )}
        <Text color="gray">```</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="gray">{`\`\`\`${trimmedLanguage ?? ""}`}</Text>
      {renderCodeLines(plainLines, "white")}
      <Text color="gray">```</Text>
    </Box>
  );
}
