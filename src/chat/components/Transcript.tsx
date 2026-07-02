import { Box } from "ink";
import type { ReasoningDisplay } from "../../core/config.js";
import type { ChatLine } from "../types.js";
import { ChatMessage } from "./ChatMessage.js";
import { ThoughtEvent } from "./ThoughtEvent.js";
import { ToolEvent } from "./ToolEvent.js";

type TranscriptLineProps = {
  line: ChatLine;
  assistantName?: string;
  reasoningDisplay?: ReasoningDisplay;
};

/** Renders a single transcript entry by role. Shared by the committed (Static) history and the live region. */
export function TranscriptLine({
  line,
  assistantName,
  reasoningDisplay,
}: TranscriptLineProps) {
  return (
    <Box flexDirection="column" marginBottom={1} width="100%">
      {line.role === "tool" ? (
        <ToolEvent line={line} />
      ) : line.role === "thought" ? (
        <ThoughtEvent
          line={line}
          assistantName={assistantName}
          reasoningDisplay={reasoningDisplay}
        />
      ) : (
        <ChatMessage line={line} assistantName={assistantName} />
      )}
    </Box>
  );
}

type LiveTranscriptProps = {
  lines: ChatLine[];
  assistantName?: string;
  reasoningDisplay?: ReasoningDisplay;
};

/**
 * The in-progress tail of the transcript: entries that have not finalized yet
 * (streaming assistant text, running tools, active reasoning). Finished entries
 * are flushed to the terminal scrollback via Ink's <Static> in the app shell,
 * so this region stays small and only it re-renders each frame.
 */
export function LiveTranscript({
  lines,
  assistantName,
  reasoningDisplay,
}: LiveTranscriptProps) {
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
          reasoningDisplay={reasoningDisplay}
        />
      ))}
    </Box>
  );
}
