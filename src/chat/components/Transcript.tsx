import { Box } from "ink";
import type { ChatLine } from "../types.js";
import { ChatMessage } from "./ChatMessage.js";
import { ThoughtEvent } from "./ThoughtEvent.js";
import { ToolEvent } from "./ToolEvent.js";

type TranscriptLineProps = {
  line: ChatLine;
  assistantName?: string;
};

/** Renders a single transcript entry by role. Shared by the committed (Static) history and the live region. */
export function TranscriptLine({ line, assistantName }: TranscriptLineProps) {
  return line.role === "tool" ? (
    <ToolEvent line={line} />
  ) : line.role === "thought" ? (
    <ThoughtEvent line={line} assistantName={assistantName} />
  ) : (
    <ChatMessage line={line} assistantName={assistantName} />
  );
}

type LiveTranscriptProps = {
  lines: ChatLine[];
  assistantName?: string;
};

/**
 * The in-progress tail of the transcript: entries that have not finalized yet
 * (streaming assistant text, running tools, active reasoning). Finished entries
 * are flushed to the terminal scrollback via Ink's <Static> in the app shell,
 * so this region stays small and only it re-renders each frame.
 */
export function LiveTranscript({ lines, assistantName }: LiveTranscriptProps) {
  if (lines.length === 0) {
    return null;
  }
  return (
    <Box flexDirection="column">
      {lines.map((line) => (
        <TranscriptLine
          key={line.id}
          line={line}
          assistantName={assistantName}
        />
      ))}
    </Box>
  );
}
