import { Text } from "ink";
import type { Config } from "../../core/config.js";
import { MODE_DEFINITIONS, type SessionMode } from "../../core/modes/index.js";
import {
  currentReasoningEffort,
  REASONING_EFFORT_LEVELS,
  REASONING_EFFORT_OFF,
} from "../../core/utils/reasoning-effort.js";
import { ApprovalPrompt } from "./ApprovalPrompt.js";
import { QuestionPrompt } from "./QuestionPrompt.js";
import { SelectPicker } from "./SelectPicker.js";
import type { ApprovalDecision, ApprovalRequest } from "../types.js";
import type { ChatQuestion } from "../questions.js";
import { theme } from "../../core/theme.js";

export type ChatPicker =
  null | "model" | "effort" | "yolo" | "mode" | "sessions";

type ChromePickerProps = {
  config: Config;
  pendingApproval: boolean;
  approvalRequest: ApprovalRequest | null;
  pendingQuestion: ChatQuestion | null;
  picker: ChatPicker;
  yoloOn: boolean;
  sessionMode: SessionMode;
  onApprovalDecision: (decision: ApprovalDecision, reason?: string) => void;
  onQuestionAnswer: (answer: string) => void;
  onQuestionDismiss: () => void;
  sessionItems: Array<{ label: string; value: string }>;
  onModelSelect: (name: string) => void;
  onEffortSelect: (value: string) => void;
  onYoloSelect: (value: string) => void;
  onModeSelect: (value: string) => void;
  onSessionSelect: (value: string) => void;
};

export function ChromePicker({
  config,
  pendingApproval,
  approvalRequest,
  pendingQuestion,
  picker,
  yoloOn,
  sessionMode,
  onApprovalDecision,
  onQuestionAnswer,
  onQuestionDismiss,
  sessionItems,
  onModelSelect,
  onEffortSelect,
  onYoloSelect,
  onModeSelect,
  onSessionSelect,
}: ChromePickerProps) {
  if (pendingApproval) {
    return (
      <ApprovalPrompt
        request={approvalRequest}
        onDecision={onApprovalDecision}
      />
    );
  }

  if (pendingQuestion) {
    return (
      <QuestionPrompt
        question={pendingQuestion}
        onAnswer={onQuestionAnswer}
        onDismiss={onQuestionDismiss}
      />
    );
  }

  if (picker === "model") {
    return (
      <SelectPicker
        title="Choose model"
        items={config.llms.map((entry) => ({
          label: `${entry.name} • ${entry.provider}/${entry.options.model}${entry.default ? " • current" : ""}`,
          value: entry.name,
        }))}
        onSelect={onModelSelect}
      />
    );
  }

  if (picker === "effort") {
    const active = currentReasoningEffort(config);
    return (
      <SelectPicker
        title="Reasoning effort"
        items={[
          {
            label: `${REASONING_EFFORT_OFF} • no reasoning${
              active === undefined ? " • current" : ""
            }`,
            value: REASONING_EFFORT_OFF,
          },
          ...REASONING_EFFORT_LEVELS.map((level) => ({
            label: `${level}${active === level ? " • current" : ""}`,
            value: level,
          })),
        ]}
        onSelect={onEffortSelect}
      />
    );
  }

  if (picker === "yolo") {
    return (
      <SelectPicker
        title="Auto-approve tools (yolo)"
        items={[
          {
            label: `Off • confirm each tool${!yoloOn ? " • current" : ""}`,
            value: "off",
          },
          {
            label: `On • run tools without prompts${yoloOn ? " • current" : ""}`,
            value: "on",
          },
        ]}
        onSelect={onYoloSelect}
      />
    );
  }

  if (picker === "mode") {
    return (
      <SelectPicker
        title="Session mode"
        items={MODE_DEFINITIONS.map((entry) => ({
          label: `${entry.name} • ${entry.description}${
            sessionMode === entry.id ? " • current" : ""
          }`,
          value: entry.id,
        }))}
        onSelect={onModeSelect}
      />
    );
  }

  if (picker === "sessions") {
    if (sessionItems.length === 0) {
      return (
        <Text color={theme.muted}>
          No saved sessions found for this directory.
        </Text>
      );
    }
    return (
      <SelectPicker
        title="Resume saved session"
        items={sessionItems}
        onSelect={onSessionSelect}
      />
    );
  }

  return null;
}
