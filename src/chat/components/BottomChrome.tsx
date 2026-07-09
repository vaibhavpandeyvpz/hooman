import { Box } from "ink";
import type { Manager as McpManager } from "../../core/mcp/index.js";
import type { TodoViewState } from "../../core/state/todos.js";
import type { ShellJobInfo } from "../../core/shell/index.js";
import type { Config } from "../../core/config.js";
import type { SessionMode } from "../../core/state/session-mode.js";
import type { ModelDownloadProgress } from "../../core/utils/download-progress.js";
import { Composer } from "./Composer.js";
import { ChromePicker, type ChatPicker } from "./ChromePicker.js";
import { DownloadPanel } from "./DownloadPanel.js";
import { QueuedPrompts } from "./QueuedPrompts.js";
import { SlashCommands } from "./SlashCommands.js";
import { StatusBar } from "./StatusBar.js";
import { TodoPanel } from "./TodoPanel.js";
import { BackgroundJobsPanel } from "./BackgroundJobsPanel.js";
import type { ApprovalDecision, ApprovalRequest } from "../types.js";
import type { ChatQuestion } from "../questions.js";
import type { PromptSubmission } from "./prompt-input/hooks/usePromptInputController.js";
import type { SlashCommandMenuProps } from "./prompt-input/hooks/usePromptInputController.js";

type QueuedPrompt = {
  id: string;
  prompt: PromptSubmission;
};

type BottomChromeProps = {
  config: Config;
  running: boolean;
  currentModel: string;
  reasoningEffort?: string;
  yoloOn: boolean;
  sessionMode: SessionMode;
  elapsedLabel: string;
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
    tokensPerSecond?: number;
  };
  /** Context-window utilization; only set when the window size was resolved. */
  contextUsage?: { used: number; size: number };
  /** Cumulative session cost in USD; only set when pricing was resolved. */
  costUsd?: number;
  /** In-flight model weights download (llama.cpp GGUF fetch), if any. */
  downloadProgress: ModelDownloadProgress | null;
  todoState: TodoViewState;
  shellJobs: readonly ShellJobInfo[];
  pendingStopJob: ShellJobInfo | null;
  queuedPrompts: readonly QueuedPrompt[];
  pendingApproval: boolean;
  approvalRequest: ApprovalRequest | null;
  pendingQuestion: ChatQuestion | null;
  picker: ChatPicker;
  slashCommands: readonly { name: string; description: string }[];
  slashHighlightIndex: number;
  input: string;
  inputHint: string;
  slashMenu?: SlashCommandMenuProps;
  onApprovalDecision: (decision: ApprovalDecision, reason?: string) => void;
  onQuestionAnswer: (answer: string) => void;
  onQuestionDismiss: () => void;
  sessionItems: Array<{ label: string; value: string }>;
  onModelSelect: (name: string) => void;
  onEffortSelect: (value: string) => void;
  onYoloSelect: (value: string) => void;
  onModeSelect: (value: string) => void;
  onSessionSelect: (value: string) => void;
  onTaskSelect: (jobId: string) => void;
  onStopTaskConfirm: (confirm: boolean) => void;
  onInputChange: (value: string) => void;
  onSubmit: (value: PromptSubmission) => void;
};

export function BottomChrome({
  config,
  running,
  currentModel,
  reasoningEffort,
  yoloOn,
  sessionMode,
  elapsedLabel,
  totalTools,
  skillsFound,
  manager,
  mcpNeedsAttention,
  usage,
  contextUsage,
  costUsd,
  downloadProgress,
  todoState,
  shellJobs,
  pendingStopJob,
  queuedPrompts,
  pendingApproval,
  approvalRequest,
  pendingQuestion,
  picker,
  sessionItems,
  slashCommands,
  slashHighlightIndex,
  input,
  inputHint,
  slashMenu,
  onApprovalDecision,
  onQuestionAnswer,
  onQuestionDismiss,
  onModelSelect,
  onEffortSelect,
  onYoloSelect,
  onModeSelect,
  onSessionSelect,
  onTaskSelect,
  onStopTaskConfirm,
  onInputChange,
  onSubmit,
}: BottomChromeProps) {
  return (
    <Box flexDirection="column" flexShrink={0}>
      {running && todoState.visible && todoState.todos.length > 0 ? (
        <TodoPanel todos={todoState.todos} />
      ) : null}

      <BackgroundJobsPanel jobs={shellJobs} />

      <QueuedPrompts prompts={queuedPrompts} />

      <ChromePicker
        config={config}
        pendingApproval={pendingApproval}
        approvalRequest={approvalRequest}
        pendingQuestion={pendingQuestion}
        picker={picker}
        yoloOn={yoloOn}
        sessionMode={sessionMode}
        shellJobs={shellJobs}
        pendingStopJob={pendingStopJob}
        onApprovalDecision={onApprovalDecision}
        onQuestionAnswer={onQuestionAnswer}
        onQuestionDismiss={onQuestionDismiss}
        sessionItems={sessionItems}
        onModelSelect={onModelSelect}
        onEffortSelect={onEffortSelect}
        onYoloSelect={onYoloSelect}
        onModeSelect={onModeSelect}
        onSessionSelect={onSessionSelect}
        onTaskSelect={onTaskSelect}
        onStopTaskConfirm={onStopTaskConfirm}
      />

      {!pendingApproval && !pendingQuestion && !picker ? (
        <SlashCommands
          items={slashCommands}
          highlightIndex={slashHighlightIndex}
        />
      ) : null}

      {!pendingApproval && !pendingQuestion && !picker ? (
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

      {downloadProgress ? <DownloadPanel progress={downloadProgress} /> : null}

      <StatusBar
        running={running}
        currentModel={currentModel}
        reasoningEffort={reasoningEffort}
        yoloOn={yoloOn}
        sessionMode={sessionMode}
        elapsedLabel={elapsedLabel}
        totalTools={totalTools}
        skillsFound={skillsFound}
        manager={manager}
        mcpNeedsAttention={mcpNeedsAttention}
        usage={usage}
        contextUsage={contextUsage}
        costUsd={costUsd}
      />
    </Box>
  );
}
