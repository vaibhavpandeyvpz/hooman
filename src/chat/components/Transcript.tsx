import { Box } from "ink";
import type { ChatLine } from "../types.js";
import { ChatMessage } from "./ChatMessage.js";
import { EmptyChatBanner } from "./EmptyChatBanner.js";
import { ThoughtEvent } from "./ThoughtEvent.js";
import { ToolEvent } from "./ToolEvent.js";

type TranscriptProps = { lines: ChatLine[] };

export function Transcript({ lines }: TranscriptProps) {
  return (
    <Box flexDirection="column" marginTop={1}>
      {lines.length === 0 ? (
        <EmptyChatBanner />
      ) : (
        lines.map((line) =>
          line.role === "tool" ? (
            <ToolEvent key={line.id} line={line} />
          ) : line.role === "thought" ? (
            <ThoughtEvent key={line.id} line={line} />
          ) : (
            <ChatMessage key={line.id} line={line} />
          ),
        )
      )}
    </Box>
  );
}
