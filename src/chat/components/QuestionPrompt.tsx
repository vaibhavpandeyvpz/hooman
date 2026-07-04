import { useState } from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import type { ChatQuestion } from "../questions.js";

const FREE_TEXT_VALUE = "__free_text__";
const DISMISS_VALUE = "__dismiss__";

type QuestionPromptProps = {
  question: ChatQuestion;
  onAnswer: (answer: string) => void;
  onDismiss: () => void;
};

export function QuestionPrompt({
  question,
  onAnswer,
  onDismiss,
}: QuestionPromptProps) {
  const [freeTextMode, setFreeTextMode] = useState(false);
  const [freeText, setFreeText] = useState("");

  if (freeTextMode) {
    return (
      <Box flexDirection="column">
        <Text color="cyan" bold>
          {question.question}
        </Text>
        <Box marginTop={1}>
          <Text color="gray">{"> "}</Text>
          <TextInput
            value={freeText}
            onChange={setFreeText}
            onSubmit={(value) => {
              const trimmed = value.trim();
              if (trimmed) {
                onAnswer(trimmed);
              } else {
                onDismiss();
              }
            }}
            placeholder="Type your answer"
          />
        </Box>
        <Box marginTop={1}>
          <Text color="gray">enter submit • empty answer dismisses</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="cyan" bold>
        {question.question}
      </Text>
      <SelectInput<string>
        items={[
          ...question.options.map((option) => ({
            label: option,
            value: option,
          })),
          { label: "Type your own answer…", value: FREE_TEXT_VALUE },
          { label: "Dismiss", value: DISMISS_VALUE },
        ]}
        onSelect={(item) => {
          if (item.value === FREE_TEXT_VALUE) {
            setFreeTextMode(true);
            return;
          }
          if (item.value === DISMISS_VALUE) {
            onDismiss();
            return;
          }
          onAnswer(item.value);
        }}
      />
      <Box marginTop={1}>
        <Text color="gray">up/down - choose - enter select</Text>
      </Box>
    </Box>
  );
}
