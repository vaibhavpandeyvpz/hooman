import { Box } from "ink";
import type { ChatLine } from "../types.js";
import { ChatMessage } from "./ChatMessage.js";
import { EmptyChatBanner } from "./EmptyChatBanner.js";
import { ThoughtEvent } from "./ThoughtEvent.js";
import { ToolEvent } from "./ToolEvent.js";

type TranscriptProps = {
  lines: ChatLine[];
  showEmptyBanner?: boolean;
  marginTop?: number;
};

type TranscriptLineProps = { line: ChatLine };

export function TranscriptLine({ line }: TranscriptLineProps) {
  return line.role === "tool" ? (
    <ToolEvent line={line} />
  ) : line.role === "thought" ? (
    <ThoughtEvent line={line} />
  ) : (
    <ChatMessage line={line} />
  );
}

export function Transcript({
  lines,
  showEmptyBanner = true,
  marginTop = 1,
}: TranscriptProps) {
  return (
    <Box flexDirection="column" marginTop={marginTop} width="100%">
      {lines.length === 0 && showEmptyBanner ? (
        <EmptyChatBanner />
      ) : (
        lines.map((line) => <TranscriptLine key={line.id} line={line} />)
      )}
    </Box>
  );
}
