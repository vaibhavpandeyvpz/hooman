import { useMemo, useRef } from "react";
import { type Token } from "marked";
import { lexMarkdown, splitStreamingMarkdown } from "../lexer.ts";

export type MarkdownTokenPlan = {
  fullTokens: Token[];
  stablePrefix: string;
  unstableSuffix: string;
  stableTokens: Token[];
  unstableTokens: Token[];
};

export function useMarkdownTokens(
  content: string,
  streaming: boolean,
): MarkdownTokenPlan {
  const stablePrefixRef = useRef("");
  const fullTokens = useMemo(() => lexMarkdown(content), [content]);

  const streamSegments = streaming
    ? splitStreamingMarkdown(content, stablePrefixRef.current)
    : { stablePrefix: "", unstableSuffix: "" };

  const stableTokens = useMemo(
    () => lexMarkdown(streamSegments.stablePrefix),
    [streamSegments.stablePrefix],
  );
  const unstableTokens = useMemo(
    () => lexMarkdown(streamSegments.unstableSuffix),
    [streamSegments.unstableSuffix],
  );

  if (!streaming) {
    stablePrefixRef.current = "";
  } else {
    stablePrefixRef.current = streamSegments.stablePrefix;
  }

  return {
    fullTokens,
    stablePrefix: streamSegments.stablePrefix,
    unstableSuffix: streamSegments.unstableSuffix,
    stableTokens,
    unstableTokens,
  };
}
