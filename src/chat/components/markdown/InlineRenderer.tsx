import React from "react";
import { Text } from "ink";
import type { Token } from "marked";
import { theme } from "../../../core/theme.js";

function plainFromToken(token: Token): string {
  switch (token.type) {
    case "text":
      return token.text ?? "";
    case "codespan":
      return token.text ?? "";
    case "escape":
      return token.text ?? "";
    case "link": {
      const label = inlineToPlainText(token.tokens);
      return label || token.href || "";
    }
    case "strong":
    case "em":
    case "del":
      return inlineToPlainText(token.tokens);
    case "image":
      return token.text || token.href || "";
    case "br":
      return "\n";
    default:
      return token.raw ?? "";
  }
}

export function inlineToPlainText(tokens: Token[] | undefined): string {
  if (!tokens || tokens.length === 0) {
    return "";
  }
  return tokens.map((token) => plainFromToken(token)).join("");
}

type RenderInlineOptions = {
  keyPrefix?: string;
};

export function renderInlineTokens(
  tokens: Token[] | undefined,
  options: RenderInlineOptions = {},
): React.ReactNode[] {
  if (!tokens || tokens.length === 0) {
    return [];
  }
  const prefix = options.keyPrefix ?? "inline";
  return tokens.flatMap((token, index) => {
    const key = `${prefix}-${index}`;
    switch (token.type) {
      case "text":
        return [token.text ?? ""];
      case "escape":
        return [token.text ?? token.raw ?? ""];
      case "codespan":
        return [
          <Text key={key} color={theme.success}>
            {token.text ?? ""}
          </Text>,
        ];
      case "strong":
        return [
          <Text key={key} bold>
            {renderInlineTokens(token.tokens, { keyPrefix: key })}
          </Text>,
        ];
      case "em":
        return [
          <Text key={key} italic>
            {renderInlineTokens(token.tokens, { keyPrefix: key })}
          </Text>,
        ];
      case "del":
        return [
          <Text key={key} dimColor>
            {renderInlineTokens(token.tokens, { keyPrefix: key })}
          </Text>,
        ];
      case "link": {
        const href = token.href ?? "";
        const text = inlineToPlainText(token.tokens).trim();
        const label = text || href;
        const shouldShowHref = Boolean(href) && label !== href;
        return [
          <Text key={`${key}-label`} color={theme.secondary} underline>
            {label}
          </Text>,
          ...(shouldShowHref
            ? [
                <Text key={`${key}-href`} color={theme.muted}>
                  {` (${href})`}
                </Text>,
              ]
            : []),
        ];
      }
      case "image": {
        const label = token.text?.trim() || "image";
        const href = token.href ?? "";
        return [
          <Text key={`${key}-img-label`} color={theme.info}>
            {`[${label}]`}
          </Text>,
          ...(href
            ? [
                <Text key={`${key}-img-href`} color={theme.muted}>
                  {` (${href})`}
                </Text>,
              ]
            : []),
        ];
      }
      case "br":
        return [<Text key={key}>{"\n"}</Text>];
      default: {
        const fallback = plainFromToken(token);
        return fallback ? [fallback] : [];
      }
    }
  });
}
