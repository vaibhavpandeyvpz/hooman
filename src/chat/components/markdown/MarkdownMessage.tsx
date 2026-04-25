import { Box } from "ink";
import { BlockRenderer } from "./BlockRenderer.tsx";
import { useMarkdownTokens } from "./hooks/useMarkdownTokens.ts";

type MarkdownMessageProps = {
  children: string;
  streaming?: boolean;
};

export function MarkdownMessage({
  children,
  streaming = false,
}: MarkdownMessageProps) {
  const content = children ?? "";
  const {
    fullTokens,
    stablePrefix,
    unstableSuffix,
    stableTokens,
    unstableTokens,
  } = useMarkdownTokens(content, streaming);

  if (!streaming) {
    return <BlockRenderer tokens={fullTokens} />;
  }

  return (
    <Box flexDirection="column">
      {stablePrefix ? <BlockRenderer tokens={stableTokens} /> : null}
      {unstableSuffix ? (
        <BlockRenderer tokens={unstableTokens} streaming />
      ) : null}
    </Box>
  );
}
