import { Box } from "ink";
import type { ChatLine } from "../types.js";
import { ChatMessage } from "./ChatMessage.js";
import { EmptyChatBanner } from "./EmptyChatBanner.js";
import { ToolEvent } from "./ToolEvent.js";

type TranscriptProps = {
  lines: ChatLine[];
  liveReasoning: string;
};

export function Transcript({ lines, liveReasoning }: TranscriptProps) {
  return (
    <Box flexDirection="column" marginTop={1}>
      {lines.length === 0 ? (
        <EmptyChatBanner />
      ) : (
        lines.map((line) =>
          line.role === "tool" ? (
            <ToolEvent key={line.id} line={line} />
          ) : (
            <ChatMessage
              key={line.id}
              line={line}
              liveReasoning={
                line.role === "assistant" && !line.done ? liveReasoning : ""
              }
            />
          ),
        )
      )}
    </Box>
  );
}
