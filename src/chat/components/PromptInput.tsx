import React from "react";
import { Box, Text } from "ink";
import { splitLineAtCursor } from "./prompt-input/render.ts";
import {
  usePromptInputController,
  type PromptSubmission,
} from "./prompt-input/usePromptInputController.ts";

export type PromptInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: PromptSubmission) => void;
  placeholder?: string;
  focus?: boolean;
  maxVisibleLines?: number;
};

export function PromptInput({
  value,
  onChange,
  onSubmit,
  placeholder = "",
  focus = true,
  maxVisibleLines = 4,
}: PromptInputProps): React.JSX.Element {
  const { view } = usePromptInputController({
    value,
    onChange,
    onSubmit,
    focus,
    maxVisibleLines,
  });

  if (view.showPlaceholder) {
    return (
      <Text>
        {focus ? <Text inverse> </Text> : null}
        {placeholder ? <Text color="gray">{placeholder}</Text> : null}
      </Text>
    );
  }

  return (
    <Box flexDirection="column">
      {view.visibleLines.map((line, index) => {
        const isCursorLine = focus && index === view.cursorLineInView;
        if (!isCursorLine) {
          return <Text key={`${view.lineOffset + index}`}>{line}</Text>;
        }
        const safeColumn = Math.min(Math.max(0, view.cursorCol), line.length);
        const parts = splitLineAtCursor(line, safeColumn);
        return (
          <Text key={`${view.lineOffset + index}`}>
            {parts.left}
            <Text inverse>{parts.at}</Text>
            {parts.right}
          </Text>
        );
      })}
    </Box>
  );
}
