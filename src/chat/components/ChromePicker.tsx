import type { Config } from "../../core/config.js";
import { MODE_DEFINITIONS, type SessionMode } from "../../core/modes/index.js";
import { ApprovalPrompt } from "./ApprovalPrompt.js";
import { SelectPicker } from "./SelectPicker.js";
import type { ApprovalDecision } from "../types.js";

export type ChatPicker = null | "model" | "yolo" | "mode";

type ChromePickerProps = {
  config: Config;
  pendingApproval: boolean;
  picker: ChatPicker;
  yoloOn: boolean;
  sessionMode: SessionMode;
  onApprovalDecision: (decision: ApprovalDecision) => void;
  onModelSelect: (name: string) => void;
  onYoloSelect: (value: string) => void;
  onModeSelect: (value: string) => void;
};

export function ChromePicker({
  config,
  pendingApproval,
  picker,
  yoloOn,
  sessionMode,
  onApprovalDecision,
  onModelSelect,
  onYoloSelect,
  onModeSelect,
}: ChromePickerProps) {
  if (pendingApproval) {
    return <ApprovalPrompt onDecision={onApprovalDecision} />;
  }

  if (picker === "model") {
    return (
      <SelectPicker
        title="Choose model"
        items={config.llms.map((entry) => ({
          label: `${entry.name} • ${entry.options.provider}/${entry.options.model}${entry.default ? " • current" : ""}`,
          value: entry.name,
        }))}
        onSelect={onModelSelect}
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

  return null;
}
