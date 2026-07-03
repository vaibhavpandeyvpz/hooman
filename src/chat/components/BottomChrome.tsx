import { Box } from "ink";
import type { Manager as McpManager } from "../../core/mcp/index.js";
import type { TodoViewState } from "../../core/state/todos.js";
import type { Config } from "../../core/config.js";
import type { SessionMode } from "../../core/state/session-mode.js";
import { Composer } from "./Composer.js";
import { ChromePicker, type ChatPicker } from "./ChromePicker.js";
import { QueuedPrompts } from "./QueuedPrompts.js";
import { SlashCommands } from "./SlashCommands.js";
import { StatusBar } from "./StatusBar.js";
import { TodoPanel } from "./TodoPanel.js";
import type { ApprovalDecision } from "../types.js";
import type { PromptSubmission } from "./prompt-input/hooks/usePromptInputController.js";
import type { SlashCommandMenuProps } from "./prompt-input/hooks/usePromptInputController.js";

type QueuedPrompt = {
  id: string;
  prompt: PromptSubmission;
};

type BottomChromeProps = {
  config: Config;
  running: boolean;
  status: string;
  currentModel: string;
  reasoningEffort?: string;
  yoloOn: boolean;
  sessionMode: SessionMode;
  elapsedLabel: string;
  turnCount: number;
  totalTools: number;
  skillsFound: number;
  manager: McpManager;
  mcpNeedsAttention: boolean;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheReadInputTokens?: number;
    cacheWriteInputTokens?: number;
    latencyMs: number;
  };
  todoState: TodoViewState;
  queuedPrompts: readonly QueuedPrompt[];
  pendingApproval: boolean;
  picker: ChatPicker;
  slashCommands: readonly { name: string; description: string }[];
  slashHighlightIndex: number;
  input: string;
  inputHint: string;
  slashMenu?: SlashCommandMenuProps;
  onApprovalDecision: (decision: ApprovalDecision) => void;
  sessionItems: Array<{ label: string; value: string }>;
  onModelSelect: (name: string) => void;
  onEffortSelect: (value: string) => void;
  onYoloSelect: (value: string) => void;
  onModeSelect: (value: string) => void;
  onSessionSelect: (value: string) => void;
  onInputChange: (value: string) => void;
  onSubmit: (value: PromptSubmission) => void;
};

export function BottomChrome({
  config,
  running,
  status,
  currentModel,
  reasoningEffort,
  yoloOn,
  sessionMode,
  elapsedLabel,
  turnCount,
  totalTools,
  skillsFound,
  manager,
  mcpNeedsAttention,
  usage,
  todoState,
  queuedPrompts,
  pendingApproval,
  picker,
  sessionItems,
  slashCommands,
  slashHighlightIndex,
  input,
  inputHint,
  slashMenu,
  onApprovalDecision,
  onModelSelect,
  onEffortSelect,
  onYoloSelect,
  onModeSelect,
  onSessionSelect,
  onInputChange,
  onSubmit,
}: BottomChromeProps) {
  return (
    <Box flexDirection="column" flexShrink={0}>
      {running && todoState.visible && todoState.todos.length > 0 ? (
        <TodoPanel todos={todoState.todos} />
      ) : null}

      <QueuedPrompts prompts={queuedPrompts} />

      <ChromePicker
        config={config}
        pendingApproval={pendingApproval}
        picker={picker}
        yoloOn={yoloOn}
        sessionMode={sessionMode}
        onApprovalDecision={onApprovalDecision}
        sessionItems={sessionItems}
        onModelSelect={onModelSelect}
        onEffortSelect={onEffortSelect}
        onYoloSelect={onYoloSelect}
        onModeSelect={onModeSelect}
        onSessionSelect={onSessionSelect}
      />

      {!pendingApproval && !picker ? (
        <SlashCommands
          items={slashCommands}
          highlightIndex={slashHighlightIndex}
        />
      ) : null}

      {!pendingApproval && !picker ? (
        <Composer
          input={input}
          running={running}
          disabled={pendingApproval}
          hint={inputHint}
          onChange={onInputChange}
          onSubmit={onSubmit}
          slashMenu={slashMenu}
        />
      ) : null}

      <StatusBar
        running={running}
        status={status}
        currentModel={currentModel}
        reasoningEffort={reasoningEffort}
        yoloOn={yoloOn}
        sessionMode={sessionMode}
        elapsedLabel={elapsedLabel}
        turnCount={turnCount}
        totalTools={totalTools}
        skillsFound={skillsFound}
        manager={manager}
        mcpNeedsAttention={mcpNeedsAttention}
        usage={usage}
      />
    </Box>
  );
}
