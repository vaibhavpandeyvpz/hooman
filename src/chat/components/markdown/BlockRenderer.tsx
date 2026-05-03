import React from "react";
import { Box, Text, useWindowSize } from "ink";
import type { Token, Tokens } from "marked";
import { CodeBlock } from "./CodeBlock.js";
import { inlineToPlainText, renderInlineTokens } from "./InlineRenderer.js";
import { MarkdownTable } from "./MarkdownTable.js";

type BlockRendererProps = {
  tokens: Token[];
  streaming?: boolean;
  depth?: number;
  /**
   * When true, the final top-level token omits block bottom margin so spacing matches plain user
   * messages (ChatMessage already applies marginBottom).
   */
  omitTrailingBlockMargin?: boolean;
};

function blockToPlainText(token: Token): string {
  switch (token.type) {
    case "paragraph":
      return inlineToPlainText(token.tokens);
    case "text":
      return token.text ?? "";
    case "code":
      return token.text ?? "";
    case "heading":
      return inlineToPlainText(token.tokens);
    case "blockquote":
      return (token.tokens ?? [])
        .map((child) => blockToPlainText(child))
        .join("\n");
    case "list":
      return token.items
        .map((item: Tokens.ListItem) =>
          (item.tokens ?? [])
            .map((child: Token) => blockToPlainText(child))
            .join(" "),
        )
        .join("\n");
    default:
      return token.raw ?? "";
  }
}

function renderBlock(
  token: Token,
  key: string,
  depth: number,
  columns: number,
  streaming: boolean,
  stripBottomMargin: boolean,
): React.ReactNode | null {
  const mb = stripBottomMargin ? 0 : 1;
  switch (token.type) {
    case "paragraph":
      return (
        <Box key={key} marginBottom={mb}>
          <Text wrap="wrap">
            {renderInlineTokens(token.tokens, { keyPrefix: key })}
          </Text>
        </Box>
      );
    case "heading": {
      const headingColor = token.depth <= 2 ? "cyan" : "white";
      return (
        <Box key={key} marginBottom={mb}>
          <Text bold color={headingColor} wrap="wrap">
            {renderInlineTokens(token.tokens, { keyPrefix: key })}
          </Text>
        </Box>
      );
    }
    case "code":
      return (
        <CodeBlock
          key={key}
          code={token.text ?? ""}
          language={token.lang}
          streaming={streaming}
          omitBottomMargin={stripBottomMargin}
        />
      );
    case "blockquote": {
      const lines = (token.tokens ?? [])
        .map((child) => blockToPlainText(child))
        .join("\n")
        .split("\n");
      return (
        <Box key={key} flexDirection="column" marginBottom={mb}>
          {lines.map((line, index) => (
            <Text key={`${key}-${index}`} color="gray" italic>
              {`│ ${line || " "}`}
            </Text>
          ))}
        </Box>
      );
    }
    case "list":
      return (
        <Box key={key} flexDirection="column" marginBottom={mb}>
          {token.items.map((item: Tokens.ListItem, index: number) => {
            const marker = token.ordered
              ? `${(token.start ?? 1) + index}.`
              : "-";
            const checkbox =
              item.task === true ? (item.checked ? "[x] " : "[ ] ") : "";
            const itemTokens = item.tokens ?? [];
            const [head, ...tail] = itemTokens as Token[];
            const isInlineHead =
              head?.type === "text" || head?.type === "paragraph";
            const headNode =
              head && isInlineHead ? (
                <Text wrap="wrap">
                  {head.type === "paragraph"
                    ? renderInlineTokens(head.tokens, {
                        keyPrefix: `${key}-item-${index}-paragraph`,
                      })
                    : (head.text ??
                      renderInlineTokens(head.tokens, {
                        keyPrefix: `${key}-item-${index}-text`,
                      }))}
                </Text>
              ) : head ? (
                renderBlock(
                  head,
                  `${key}-item-${index}-head`,
                  depth + 1,
                  columns,
                  streaming,
                  false,
                )
              ) : (
                <Text> </Text>
              );
            return (
              <Box key={`${key}-item-${index}`} flexDirection="column">
                <Box flexDirection="row">
                  <Text>{`${"  ".repeat(depth)}${marker} ${checkbox}`}</Text>
                  <Box flexDirection="column" flexGrow={1}>
                    {headNode}
                  </Box>
                </Box>
                {tail.length > 0 ? (
                  <Box
                    marginLeft={Math.max(2, depth * 2 + 4)}
                    flexDirection="column"
                  >
                    {tail.map((nestedToken: Token, nestedIndex: number) =>
                      renderBlock(
                        nestedToken,
                        `${key}-item-${index}-tail-${nestedIndex}`,
                        depth + 1,
                        columns,
                        streaming,
                        false,
                      ),
                    )}
                  </Box>
                ) : null}
              </Box>
            );
          })}
        </Box>
      );
    case "table":
      return (
        <MarkdownTable
          key={key}
          token={token as Tokens.Table}
          omitBottomMargin={stripBottomMargin}
        />
      );
    case "hr":
      return (
        <Box key={key} marginBottom={mb}>
          <Text color="gray">
            {"─".repeat(Math.max(8, Math.min(columns - 4, 48)))}
          </Text>
        </Box>
      );
    case "space":
      return null;
    case "text":
    case "escape":
      return (
        <Box key={key} marginBottom={mb}>
          <Text wrap="wrap">{token.text ?? token.raw ?? ""}</Text>
        </Box>
      );
    case "html":
    case "def":
    case "del":
      return null;
    default:
      return (
        <Box key={key} marginBottom={mb}>
          <Text wrap="wrap">{token.raw ?? ""}</Text>
        </Box>
      );
  }
}

export function BlockRenderer({
  tokens,
  streaming = false,
  depth = 0,
  omitTrailingBlockMargin = false,
}: BlockRendererProps) {
  const { columns } = useWindowSize();
  const lastIndex = tokens.length - 1;
  return (
    <Box flexDirection="column">
      {tokens.map((token, index) =>
        renderBlock(
          token,
          `block-${depth}-${index}`,
          depth,
          columns,
          streaming,
          omitTrailingBlockMargin && index === lastIndex,
        ),
      )}
    </Box>
  );
}
