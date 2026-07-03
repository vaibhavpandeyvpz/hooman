import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import fastq from "fastq";
import { Box, Static, useApp, useInput, useWindowSize } from "ink";
import {
  Message,
  TextBlock,
  ToolResultBlock,
  ToolUseBlock,
  type Agent,
  type AgentStreamEvent,
  type ContentBlock,
  type Usage,
} from "@strands-agents/sdk";
import {
  accumulateUsage,
  createEmptyUsage,
} from "../core/utils/strands-usage-accumulate.js";
import type { Config } from "../core/config.js";
import type { Manager as McpManager } from "../core/mcp/index.js";
import { modelProviders } from "../core/models/index.js";
import {
  currentReasoningEffort,
  nextReasoningEffort,
  parseReasoningEffortArg,
  readProviderEffort,
  REASONING_EFFORT_LEVELS,
  REASONING_EFFORT_OFF,
  withReasoningEffort,
} from "../core/models/reasoning-effort.js";
import { formatModeNames, isKnownSessionMode } from "../core/modes/index.js";
import type { Registry } from "../core/skills/index.js";
import { takeFileToolDisplay } from "../core/state/file-tool-display.js";
import { ChatApprovalController } from "./approvals.js";
import { ChatTurnSteeringController } from "./steering.js";
import { BottomChrome } from "./components/BottomChrome.js";
import { LiveTranscript, TranscriptLine } from "./components/Transcript.js";
import { EmptyChatBanner } from "./components/EmptyChatBanner.js";
import type { ApprovalRequest, ChatLine } from "./types.js";
import { getTodoViewState, type TodoViewState } from "../core/state/todos.js";
import { isExitRequested } from "../core/state/exit-request.js";
import {
  getModeState,
  setSessionMode,
  type SessionMode,
} from "../core/state/session-mode.js";
import { isYoloEnabled, setYoloEnabled } from "../core/state/yolo.js";
import { applySessionMode } from "../core/agent/sync-tool-registry-mode.js";
import {
  getAgentConversationManager,
  getAgentSessionManager,
} from "../core/agent/index.js";
import { attachmentPathsToPromptBlocks } from "../core/utils/attachments.js";
import { isMouseInput } from "./mouse.js";
import type { PromptSubmission } from "./components/prompt-input/hooks/usePromptInputController.js";
import { readBundledPrompt } from "../core/prompts/bundled.js";
import { runWithAgentMemoryScope } from "../core/memory/index.js";
import type { ChatPicker } from "./components/ChromePicker.js";
import { listCliSessions } from "../core/sessions/list-cli-sessions.js";

/** Status bar: Strands `Usage` for the current user turn + summed latency across model cycles. */
type TurnUsageStatus = Usage & { latencyMs: number };

function emptyTurnUsage(): TurnUsageStatus {
  return { ...createEmptyUsage(), latencyMs: 0 };
}

type ChatAppProps = {
  agent: Agent;
  config: Config;
  sessionId: string;
  manager: McpManager;
  registry: Registry;
  approvals: ChatApprovalController;
  steering: ChatTurnSteeringController;
  prompt?: string;
  onExit: () => void;
  onNewSession: () => void;
  onResumeSession: (sessionId: string) => void;
  onConfigure: () => void;
};

type QueuedPrompt = {
  id: string;
  prompt: PromptSubmission;
};

function normalizePromptSubmission(
  value: string | PromptSubmission,
): PromptSubmission {
  if (typeof value === "string") {
    return { text: value, attachments: [] };
  }
  return {
    text: value.text,
    attachments: [
      ...new Set(value.attachments.map((item) => item.trim()).filter(Boolean)),
    ],
  };
}

const INPUT_HINT =
  "shift/meta+enter or \\+enter: newline | esc/ctrl+c: cancel or exit";
const INPUT_HINT_WITH_STEERING =
  "enter on empty input: steer active turn with queued prompts | shift/meta+enter or \\+enter: newline | esc/ctrl+c: cancel or exit";

const INIT_AGENTS_PROMPT = readBundledPrompt("static", "init.md");

function nowId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function shortSessionId(sessionId: string): string {
  const parts = sessionId.split("-");
  return parts.length > 1 ? (parts[parts.length - 1] ?? sessionId) : sessionId;
}

function formatSessionAge(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  const deltaMs = Date.now() - date.getTime();
  if (!Number.isFinite(deltaMs)) {
    return "unknown";
  }
  if (deltaMs < 60_000) {
    return "just now";
  }
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  return date.toISOString().slice(0, 10);
}

function stringifyUnknown(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function blockToFallbackText(block: ContentBlock): string | null {
  if (block.type === "textBlock") {
    return block.text;
  }
  try {
    return JSON.stringify(block.toJSON?.() ?? block, null, 2);
  } catch {
    return String(block);
  }
}

function toToolResultText(result: unknown): string {
  const data = result as {
    status?: string;
    content?: Array<{ type?: string; text?: string; json?: unknown }>;
  };
  const pieces = (data.content ?? []).map((item) => {
    if (item.type === "textBlock" && typeof item.text === "string") {
      return item.text;
    }
    if (item.type === "jsonBlock") {
      return stringifyUnknown(item.json);
    }
    return stringifyUnknown(item);
  });
  const body = pieces.filter(Boolean).join("\n");
  return body || `Tool finished with status: ${data.status ?? "unknown"}`;
}

function getToolUseId(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const data = value as {
    toolUseId?: unknown;
    toolUse?: { toolUseId?: unknown };
  };
  if (typeof data.toolUseId === "string") {
    return data.toolUseId;
  }
  if (typeof data.toolUse?.toolUseId === "string") {
    return data.toolUse.toolUseId;
  }
  return null;
}

function estimateReasoningTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return Math.max(1, Math.round(trimmed.length / 4));
}

function buildInitialTranscript(messages: Message[]): ChatLine[] {
  const lines: ChatLine[] = [];
  const toolResults = new Map<string, ToolResultBlock>();

  for (const message of messages) {
    for (const block of message.content) {
      if (block instanceof ToolResultBlock) {
        toolResults.set(block.toolUseId, block);
      }
    }
  }

  for (const message of messages) {
    if (message.role === "user") {
      const parts = message.content
        .filter((block) => !(block instanceof ToolResultBlock))
        .map((block) => blockToFallbackText(block)?.trimEnd() ?? "")
        .filter(Boolean);
      if (parts.length > 0) {
        lines.push({
          id: nowId(),
          role: "user",
          content: parts.join("\n\n"),
          done: true,
        });
      }
      continue;
    }

    if (message.role !== "assistant") {
      continue;
    }

    for (const block of message.content) {
      if (block instanceof ToolUseBlock) {
        const result = toolResults.get(block.toolUseId);
        lines.push({
          id: nowId(),
          role: "tool",
          title: "tool",
          toolName: block.name,
          content: stringifyUnknown(block.input ?? {}),
          resultContent: result ? toToolResultText(result) : undefined,
          phase: result ? "done" : "running",
          done: Boolean(result),
        });
        continue;
      }

      if (block.type === "reasoningBlock") {
        const text = blockToFallbackText(block)?.trim();
        if (text) {
          lines.push({
            id: nowId(),
            role: "thought",
            content: text,
            done: true,
            estimatedTokens: estimateReasoningTokens(text),
          });
        }
        continue;
      }

      const text = blockToFallbackText(block)?.trimEnd();
      if (text) {
        lines.push({
          id: nowId(),
          role: "assistant",
          content: text,
          done: true,
        });
      }
    }
  }

  return lines;
}

function currentModelName(config: Config): string {
  return (
    config.llms.find((m) => m.default)?.name ??
    config.llms[0]?.name ??
    "unknown"
  );
}

function currentModelLabel(config: Config): string {
  const active = config.llms.find((m) => m.default) ?? config.llms[0];
  if (!active) {
    return "unknown";
  }
  // return `${active.name} (${active.options.provider}/${active.options.model})`;
  return active.name;
}

function parseChatCommand(text: string): { name: string; args: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  const withoutSlash = trimmed.slice(1).trim();
  if (!withoutSlash) {
    return null;
  }
  const firstSpace = withoutSlash.indexOf(" ");
  if (firstSpace === -1) {
    return { name: withoutSlash.toLowerCase(), args: "" };
  }
  return {
    name: withoutSlash.slice(0, firstSpace).toLowerCase(),
    args: withoutSlash.slice(firstSpace + 1).trim(),
  };
}

function parseYoloToggleArg(raw: string): boolean | undefined {
  const t = raw.trim().toLowerCase();
  if (
    t === "on" ||
    t === "true" ||
    t === "1" ||
    t === "yes" ||
    t === "enable" ||
    t === "enabled"
  ) {
    return true;
  }
  if (
    t === "off" ||
    t === "false" ||
    t === "0" ||
    t === "no" ||
    t === "disable" ||
    t === "disabled"
  ) {
    return false;
  }
  return undefined;
}

function parseSessionModeArg(raw: string): SessionMode | undefined {
  const t = raw.trim().toLowerCase();
  if (isKnownSessionMode(t)) {
    return t;
  }
  return undefined;
}

function listModelsText(config: Config): string {
  const current = currentModelName(config);
  const options = config.llms.map((entry) => {
    const marker = entry.name === current ? "*" : "-";
    const resolved = config.resolveLlm(entry.name);
    if (!resolved) {
      return `${marker} ${entry.name} (${entry.provider}/${entry.options.model})`;
    }
    return `${marker} ${entry.name} (${entry.provider} -> ${resolved.provider}/${resolved.llmOptions.model})`;
  });
  return [
    `Current model: ${current}`,
    "Available models:",
    ...options,
    'Use "/model <name>" to switch for this chat session.',
  ].join("\n");
}

const SLASH_COMMANDS = [
  {
    name: "compact",
    description: "Compact conversation history now.",
  },
  {
    name: "config",
    description: "Launch the configuration flow.",
  },
  {
    name: "init",
    description: "Generate or refresh AGENTS.md for this project.",
  },
  {
    name: "effort",
    description: "Pick or set the reasoning effort.",
  },
  {
    name: "mode",
    description: `Session mode: ${formatModeNames()}.`,
  },
  {
    name: "model",
    description: "Pick or set the chat model.",
  },
  {
    name: "new",
    description: "Start a new chat session.",
  },
  {
    name: "sessions",
    description: "Browse and resume saved sessions.",
  },
  {
    name: "yolo",
    description: "Auto-approve tools (on|off).",
  },
] as const;

function matchingSlashCommands(
  input: string,
): Array<(typeof SLASH_COMMANDS)[number]> {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("/")) {
    return [];
  }
  const query = trimmed.slice(1).toLowerCase();
  if (!query) {
    return [...SLASH_COMMANDS];
  }
  if (query.includes(" ")) {
    return [];
  }
  return SLASH_COMMANDS.filter((item) => item.name.startsWith(query));
}

export function ChatApp({
  agent,
  config,
  sessionId,
  manager,
  registry,
  approvals,
  steering,
  prompt,
  onExit,
  onNewSession,
  onResumeSession,
  onConfigure,
}: ChatAppProps): React.JSX.Element {
  const { exit } = useApp();
  const windowSize = useWindowSize();
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("ready");
  const [lines, setLines] = useState<ChatLine[]>(() =>
    buildInitialTranscript(agent.messages),
  );
  const [turnCount, setTurnCount] = useState(0);
  const [skillsFound, setSkillsFound] = useState(0);
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const [turnElapsedMs, setTurnElapsedMs] = useState(0);
  const [usage, setUsage] = useState<TurnUsageStatus>(emptyTurnUsage);
  const [pendingApproval, setPendingApproval] =
    useState<ApprovalRequest | null>(null);
  const [picker, setPicker] = useState<ChatPicker>(null);
  /** Forces StatusBar to re-read yolo/mode from agent when those change without a picker close or rebuild. */
  const [, setSessionChromeEpoch] = useState(0);
  const bumpSessionChrome = useCallback(() => {
    setSessionChromeEpoch((n) => n + 1);
  }, []);
  const [slashHighlightIndex, setSlashHighlightIndex] = useState(0);
  const [queuedPrompts, setQueuedPrompts] = useState<QueuedPrompt[]>([]);
  const [mcpNeedsAttention, setMcpNeedsAttention] = useState(false);
  const [sessionItems, setSessionItems] = useState<
    Array<{ label: string; value: string }>
  >([]);
  const [todoState, setTodoState] = useState<TodoViewState>(() =>
    getTodoViewState(agent),
  );
  const mountedRef = useRef(true);
  const runningRef = useRef(false);
  const assistantLineIdRef = useRef<string | null>(null);
  const assistantCommittedTextRef = useRef("");
  const streamedAssistantBlockRef = useRef<string | null>(null);
  const thoughtLineIdRef = useRef<string | null>(null);
  const thoughtTextRef = useRef("");
  const thoughtStartedAtRef = useRef<number | null>(null);
  const toolLineIdsRef = useRef(new Map<string, string>());
  const pendingToolLineIdsRef = useRef<string[]>([]);
  const initialRanRef = useRef(false);
  const queuedPromptsRef = useRef<QueuedPrompt[]>([]);
  const skippedQueueIdsRef = useRef(new Set<string>());

  useEffect(() => {
    queuedPromptsRef.current = queuedPrompts;
  }, [queuedPrompts]);

  useEffect(() => {
    let cancelled = false;
    void registry
      .list()
      .then((skills) => {
        if (!cancelled) {
          setSkillsFound(skills.length);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSkillsFound(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [registry]);

  // Surface MCP OAuth state in the status bar. Re-checked whenever a turn ends,
  // since a tool call may have triggered (or completed) an auth flow mid-session.
  useEffect(() => {
    let cancelled = false;
    void manager
      .listAuthStatuses()
      .then((rows) => {
        if (cancelled) {
          return;
        }
        setMcpNeedsAttention(
          rows.some(
            (row) =>
              row.status === "unauthenticated" || row.status === "expired",
          ),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setMcpNeedsAttention(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [manager, running]);

  useEffect(() => {
    if (!running || turnStartedAt === null) {
      setTurnElapsedMs(0);
      return;
    }
    setTurnElapsedMs(Date.now() - turnStartedAt);
    const timer = setInterval(() => {
      setTurnElapsedMs(Date.now() - turnStartedAt);
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, [running, turnStartedAt]);

  useEffect(() => {
    const cleanupListener = approvals.subscribe(() => {
      setPendingApproval(approvals.pending);
    });
    return () => {
      cleanupListener();
    };
  }, [approvals]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (!active) {
        return;
      }
      setTodoState(getTodoViewState(agent));
    };
    refresh();
    const timer = setInterval(refresh, running ? 200 : 800);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [agent, running]);

  const totalTools =
    (agent as Agent & { tools?: unknown[] }).tools?.length ?? 0;
  const slashCommands = useMemo(() => matchingSlashCommands(input), [input]);

  useEffect(() => {
    setSlashHighlightIndex((i) => {
      if (slashCommands.length === 0) {
        return 0;
      }
      return Math.min(Math.max(0, i), slashCommands.length - 1);
    });
  }, [slashCommands]);

  const completeSlashCommand = useCallback(() => {
    const cmd = slashCommands[slashHighlightIndex];
    if (!cmd) {
      return;
    }
    setInput(`/${cmd.name} `);
  }, [slashCommands, slashHighlightIndex]);

  const slashMenu = useMemo(() => {
    if (slashCommands.length === 0) {
      return undefined;
    }
    const hi = Math.min(slashHighlightIndex, slashCommands.length - 1);
    const row = slashCommands[hi];
    return {
      itemCount: slashCommands.length,
      highlightIndex: hi,
      highlightedCommandName: row?.name ?? "",
      onHighlightChange: setSlashHighlightIndex,
      completeSelected: completeSlashCommand,
    };
  }, [slashCommands, slashHighlightIndex, completeSlashCommand]);

  const appendLine = useCallback((line: ChatLine) => {
    setLines((prev) => [...prev, line]);
  }, []);

  const updateLine = useCallback((id: string, patch: Partial<ChatLine>) => {
    setLines((prev) =>
      prev.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    );
  }, []);

  const removeLine = useCallback((id: string) => {
    setLines((prev) => prev.filter((line) => line.id !== id));
  }, []);

  const replaceAssistantText = useCallback((text: string) => {
    const id = assistantLineIdRef.current;
    if (!id) {
      return;
    }
    setLines((prev) =>
      prev.map((line) => (line.id === id ? { ...line, content: text } : line)),
    );
  }, []);

  const appendAssistantText = useCallback(
    (text: string) => {
      streamedAssistantBlockRef.current = `${
        streamedAssistantBlockRef.current ?? ""
      }${text}`;
      replaceAssistantText(
        `${assistantCommittedTextRef.current}${streamedAssistantBlockRef.current}`,
      );
    },
    [replaceAssistantText],
  );

  const commitAssistantBlock = useCallback(
    (text: string) => {
      assistantCommittedTextRef.current = `${assistantCommittedTextRef.current}${text}`;
      streamedAssistantBlockRef.current = null;
      replaceAssistantText(assistantCommittedTextRef.current);
    },
    [replaceAssistantText],
  );

  const finalizeAssistantLine = useCallback(() => {
    const id = assistantLineIdRef.current;
    if (!id) {
      return;
    }
    const text = `${assistantCommittedTextRef.current}${
      streamedAssistantBlockRef.current ?? ""
    }`;
    if (text.trim().length === 0) {
      removeLine(id);
    } else {
      updateLine(id, { done: true });
    }
    assistantLineIdRef.current = null;
    assistantCommittedTextRef.current = "";
    streamedAssistantBlockRef.current = null;
  }, [removeLine, updateLine]);

  const ensureAssistantLine = useCallback((): string => {
    const existing = assistantLineIdRef.current;
    if (existing) {
      return existing;
    }
    const id = nowId();
    assistantLineIdRef.current = id;
    assistantCommittedTextRef.current = "";
    streamedAssistantBlockRef.current = null;
    appendLine({
      id,
      role: "assistant",
      content: "",
      done: false,
    });
    return id;
  }, [appendLine]);

  const finalizeThoughtLine = useCallback(() => {
    const id = thoughtLineIdRef.current;
    if (!id) {
      return;
    }
    const finishedAt = Date.now();
    updateLine(id, {
      done: true,
      finishedAt,
      estimatedTokens: estimateReasoningTokens(thoughtTextRef.current),
    });
    thoughtLineIdRef.current = null;
    thoughtTextRef.current = "";
    thoughtStartedAtRef.current = null;
  }, [updateLine]);

  const ensureThoughtLine = useCallback((): string => {
    const existing = thoughtLineIdRef.current;
    if (existing) {
      return existing;
    }
    finalizeAssistantLine();
    const startedAt = Date.now();
    const id = nowId();
    thoughtLineIdRef.current = id;
    thoughtTextRef.current = "";
    thoughtStartedAtRef.current = startedAt;
    appendLine({
      id,
      role: "thought",
      content: "",
      done: false,
      startedAt,
    });
    return id;
  }, [appendLine, finalizeAssistantLine]);

  const appendThoughtText = useCallback(
    (text: string) => {
      const id = ensureThoughtLine();
      thoughtTextRef.current = `${thoughtTextRef.current}${text}`;
      setLines((prev) =>
        prev.map((line) =>
          line.id === id
            ? { ...line, content: `${line.content}${text}` }
            : line,
        ),
      );
    },
    [ensureThoughtLine],
  );

  const handleModelCommand = useCallback(
    async (args: string) => {
      if (runningRef.current) {
        appendLine({
          id: nowId(),
          role: "system",
          title: "model",
          content:
            "Wait for the active turn to finish before switching models.",
          done: true,
        });
        return;
      }
      if (!args) {
        setPicker("model");
        return;
      }
      const match = config.llms.find((entry) => entry.name === args);
      if (!match) {
        appendLine({
          id: nowId(),
          role: "system",
          title: "model",
          content: `Unknown model "${args}".\n\n${listModelsText(config)}`,
          done: true,
        });
        return;
      }
      if (match.name === currentModelName(config)) {
        return;
      }
      const previous = currentModelName(config);
      config.update({
        llms: config.llms.map((entry) => ({
          ...entry,
          default: entry.name === match.name,
        })),
      });
      try {
        const resolved = config.llm;
        const provider = await modelProviders[resolved.provider]!();
        agent.model = provider.create(
          resolved.providerOptions,
          resolved.llmOptions,
        );
        // Persist the default-model choice to the shared config so it survives
        // restarts. Only applies when the model exists in the base config
        // (overlay-only models stay session-scoped).
        config.persistToDisk((base) =>
          base.llms.some((entry) => entry.name === match.name)
            ? {
                llms: base.llms.map((entry) => ({
                  ...entry,
                  default: entry.name === match.name,
                })),
              }
            : null,
        );
      } catch (error) {
        config.update({
          llms: config.llms.map((entry) => ({
            ...entry,
            default: entry.name === previous,
          })),
        });
        appendLine({
          id: nowId(),
          role: "system",
          title: "error",
          content: error instanceof Error ? error.message : String(error),
          done: true,
        });
      }
    },
    [agent, appendLine, config],
  );

  const applyReasoningEffort = useCallback(
    async (nextEffort: string | undefined, providerName: string) => {
      const nextProviders = config.providers.map((entry) =>
        entry.name === providerName
          ? {
              ...entry,
              options: withReasoningEffort(entry.options, nextEffort),
            }
          : entry,
      ) as typeof config.providers;
      const previousProviders = config.providers;
      config.update({ providers: nextProviders });
      try {
        const resolved = config.llm;
        const provider = await modelProviders[resolved.provider]!();
        agent.model = provider.create(
          resolved.providerOptions,
          resolved.llmOptions,
        );
        // Persist the effort change to the shared config (recomputed against the
        // base provider so its other reasoning keys stay intact). Skips when the
        // provider only exists in a project overlay.
        config.persistToDisk((base) =>
          base.providers.some((entry) => entry.name === providerName)
            ? {
                providers: base.providers.map((entry) =>
                  entry.name === providerName
                    ? {
                        ...entry,
                        options: withReasoningEffort(entry.options, nextEffort),
                      }
                    : entry,
                ) as typeof base.providers,
              }
            : null,
        );
        bumpSessionChrome();
      } catch (error) {
        config.update({ providers: previousProviders });
        bumpSessionChrome();
        appendLine({
          id: nowId(),
          role: "system",
          title: "error",
          content: error instanceof Error ? error.message : String(error),
          done: true,
        });
      }
    },
    [agent, appendLine, bumpSessionChrome, config],
  );

  const cycleReasoningEffort = useCallback(
    async (direction: 1 | -1) => {
      if (runningRef.current) {
        return;
      }
      const active =
        config.llms.find((entry) => entry.default) ?? config.llms[0];
      if (!active) {
        return;
      }
      const providerName = active.provider;
      const providerEntry = config.providers.find(
        (entry) => entry.name === providerName,
      );
      if (!providerEntry) {
        return;
      }
      const nextEffort = nextReasoningEffort(
        readProviderEffort(providerEntry.options),
        direction,
      );
      await applyReasoningEffort(nextEffort, providerName);
    },
    [applyReasoningEffort, config],
  );

  const handleEffortCommand = useCallback(
    async (args: string) => {
      if (runningRef.current) {
        appendLine({
          id: nowId(),
          role: "system",
          title: "effort",
          content:
            "Wait for the active turn to finish before changing reasoning effort.",
          done: true,
        });
        return;
      }
      const active =
        config.llms.find((entry) => entry.default) ?? config.llms[0];
      if (!active) {
        return;
      }
      const providerName = active.provider;
      if (!config.providers.some((entry) => entry.name === providerName)) {
        return;
      }
      const trimmed = args.trim();
      if (!trimmed) {
        setPicker("effort");
        return;
      }
      const parsed = parseReasoningEffortArg(trimmed);
      if (!parsed) {
        appendLine({
          id: nowId(),
          role: "system",
          title: "effort",
          content: `Unknown effort "${trimmed}". Use ${REASONING_EFFORT_LEVELS.join(
            ", ",
          )} or ${REASONING_EFFORT_OFF}.`,
          done: true,
        });
        return;
      }
      if (parsed.value === currentReasoningEffort(config)) {
        return;
      }
      await applyReasoningEffort(parsed.value, providerName);
    },
    [appendLine, applyReasoningEffort, config],
  );

  const handleYoloCommand = useCallback(
    async (args: string) => {
      if (runningRef.current) {
        appendLine({
          id: nowId(),
          role: "system",
          title: "yolo",
          content:
            "Wait for the active turn to finish before changing yolo mode.",
          done: true,
        });
        return;
      }
      const trimmed = args.trim();
      if (!trimmed) {
        setPicker("yolo");
        return;
      }
      const enabled = parseYoloToggleArg(trimmed);
      if (enabled === undefined) {
        appendLine({
          id: nowId(),
          role: "system",
          title: "yolo",
          content: `Unknown value "${trimmed}". Use on or off (or yes/no, true/false, enable/disable).`,
          done: true,
        });
        return;
      }
      const prev = isYoloEnabled(agent);
      if (prev === enabled) {
        return;
      }
      setYoloEnabled(agent, enabled);
      bumpSessionChrome();
    },
    [agent, appendLine, bumpSessionChrome],
  );

  const handleModeCommand = useCallback(
    async (args: string) => {
      if (runningRef.current) {
        appendLine({
          id: nowId(),
          role: "system",
          title: "mode",
          content:
            "Wait for the active turn to finish before switching session mode.",
          done: true,
        });
        return;
      }
      const trimmed = args.trim();
      if (!trimmed) {
        setPicker("mode");
        return;
      }
      const mode = parseSessionModeArg(trimmed);
      if (!mode) {
        appendLine({
          id: nowId(),
          role: "system",
          title: "mode",
          content: `Unknown mode "${trimmed}". Use agent, ask, or plan, or open the picker with /mode.`,
          done: true,
        });
        return;
      }
      const prev = getModeState(agent).mode;
      if (prev === mode) {
        return;
      }
      setSessionMode(agent, mode);
      applySessionMode(agent);
      bumpSessionChrome();
    },
    [agent, appendLine, bumpSessionChrome],
  );

  const handleCompactCommand = useCallback(async () => {
    if (runningRef.current) {
      appendLine({
        id: nowId(),
        role: "system",
        title: "compact",
        content:
          "Wait for the active turn to finish before compacting history.",
        done: true,
      });
      return;
    }

    const conversationManager = getAgentConversationManager(agent);
    if (!conversationManager) {
      appendLine({
        id: nowId(),
        role: "system",
        title: "compact",
        content:
          "This session does not have a conversation manager to compact.",
        done: true,
      });
      return;
    }

    const beforeCount = agent.messages.length;
    try {
      const reduced = await conversationManager.reduce({
        agent,
        model: agent.model,
      });
      const afterCount = agent.messages.length;
      if (!reduced) {
        appendLine({
          id: nowId(),
          role: "system",
          title: "compact",
          content: "Conversation history is already too short to compact.",
          done: true,
        });
        return;
      }

      await getAgentSessionManager(agent)?.saveSnapshot({
        target: agent,
        isLatest: true,
      });

      appendLine({
        id: nowId(),
        role: "system",
        title: "compact",
        content: `Compacted conversation history for future turns (${beforeCount} messages -> ${afterCount}).`,
        done: true,
      });
    } catch (error) {
      appendLine({
        id: nowId(),
        role: "system",
        title: "compact",
        content: error instanceof Error ? error.message : String(error),
        done: true,
      });
    }
  }, [agent, appendLine]);

  const handleNewCommand = useCallback(() => {
    if (runningRef.current) {
      appendLine({
        id: nowId(),
        role: "system",
        title: "new",
        content:
          "Wait for the active turn to finish before starting a new session.",
        done: true,
      });
      return;
    }
    onNewSession();
    exit();
  }, [appendLine, exit, onNewSession]);

  const handleConfigCommand = useCallback(() => {
    if (runningRef.current) {
      appendLine({
        id: nowId(),
        role: "system",
        title: "config",
        content:
          "Wait for the active turn to finish before launching configuration.",
        done: true,
      });
      return;
    }
    onConfigure();
    exit();
  }, [appendLine, exit, onConfigure]);

  const handleSessionsCommand = useCallback(async () => {
    if (runningRef.current) {
      appendLine({
        id: nowId(),
        role: "system",
        title: "sessions",
        content:
          "Wait for the active turn to finish before switching sessions.",
        done: true,
      });
      return;
    }
    const rows = await listCliSessions();
    const filtered = rows.filter((row) => row.sessionId !== sessionId);
    if (filtered.length === 0) {
      appendLine({
        id: nowId(),
        role: "system",
        title: "sessions",
        content: "No saved sessions found for this project.",
        done: true,
      });
      return;
    }
    setSessionItems(
      filtered.map((row) => ({
        value: row.sessionId,
        label: `${row.title} • ${formatSessionAge(row.updatedAt)} • ${shortSessionId(
          row.sessionId,
        )}`,
      })),
    );
    setPicker("sessions");
  }, [appendLine, sessionId]);

  const handleResumeSessionCommand = useCallback(
    (nextSessionId: string) => {
      if (runningRef.current) {
        appendLine({
          id: nowId(),
          role: "system",
          title: "sessions",
          content:
            "Wait for the active turn to finish before switching sessions.",
          done: true,
        });
        return;
      }
      onResumeSession(nextSessionId);
      exit();
    },
    [appendLine, exit, onResumeSession],
  );

  const runTurn = useCallback(
    async (prompt: PromptSubmission) => {
      const trimmed = prompt.text.trim();
      if (!trimmed && prompt.attachments.length === 0) {
        return;
      }
      const attachmentBlocks = await attachmentPathsToPromptBlocks(
        prompt.attachments,
      );

      runningRef.current = true;
      setRunning(true);
      setStatus("thinking");
      setTurnStartedAt(Date.now());
      setTurnCount((value) => value + 1);
      appendLine({
        id: nowId(),
        role: "user",
        content:
          prompt.attachments.length > 0
            ? `${trimmed || "[attachments]"}\n\n${prompt.attachments
                .map((attachmentPath) => `[attachment] ${attachmentPath}`)
                .join("\n")}`
            : trimmed,
        done: true,
      });
      try {
        const streamInput =
          attachmentBlocks.length > 0
            ? [
                new Message({
                  role: "user",
                  content: [
                    ...(trimmed ? [new TextBlock(trimmed)] : []),
                    ...attachmentBlocks,
                  ] as ContentBlock[],
                }),
              ]
            : trimmed;
        await runWithAgentMemoryScope(agent, async () => {
          for await (const event of agent.stream(streamInput)) {
            const e = event as AgentStreamEvent;
            switch (e.type) {
              case "contentBlockEvent": {
                const block = e.contentBlock as {
                  type?: string;
                  text?: string;
                  name?: string;
                  input?: unknown;
                };
                if (block.type === "textBlock") {
                  finalizeThoughtLine();
                  ensureAssistantLine();
                  commitAssistantBlock(block.text ?? "");
                } else if (block.type === "toolUseBlock") {
                  finalizeThoughtLine();
                  finalizeAssistantLine();
                  const toolId = nowId();
                  const toolUseId = getToolUseId(block);
                  if (toolUseId) {
                    toolLineIdsRef.current.set(toolUseId, toolId);
                  } else {
                    pendingToolLineIdsRef.current.push(toolId);
                  }
                  appendLine({
                    id: toolId,
                    role: "tool",
                    title: "tool",
                    toolName: block.name ?? "unknown",
                    content: stringifyUnknown(block.input ?? {}),
                    phase: "running",
                    done: false,
                  });
                }
                break;
              }
              case "toolResultEvent": {
                const resultContent = toToolResultText(e.result);
                const toolUseId = getToolUseId(e.result);
                const fileToolDisplay = takeFileToolDisplay(
                  agent.appState,
                  toolUseId,
                );
                let toolLineId = toolUseId
                  ? toolLineIdsRef.current.get(toolUseId)
                  : undefined;
                if (toolLineId && toolUseId) {
                  toolLineIdsRef.current.delete(toolUseId);
                }
                toolLineId ??= pendingToolLineIdsRef.current.shift();
                if (!toolLineId) {
                  const firstTrackedTool = toolLineIdsRef.current
                    .entries()
                    .next();
                  if (!firstTrackedTool.done) {
                    const [trackedToolUseId, trackedToolLineId] =
                      firstTrackedTool.value;
                    toolLineIdsRef.current.delete(trackedToolUseId);
                    toolLineId = trackedToolLineId;
                  }
                }
                if (toolLineId) {
                  updateLine(toolLineId, {
                    phase: "done",
                    done: true,
                    resultContent,
                    fileToolDisplay,
                  });
                } else {
                  appendLine({
                    id: nowId(),
                    role: "tool",
                    title: "tool",
                    toolName: "unknown",
                    content: "",
                    resultContent,
                    fileToolDisplay,
                    phase: "done",
                    done: true,
                  });
                }
                break;
              }
              case "toolStreamUpdateEvent":
                setStatus("running tool");
                break;
              case "modelStreamUpdateEvent": {
                const modelEvent = (
                  e as {
                    event?: {
                      type?: string;
                      usage?: unknown;
                      metrics?: unknown;
                    };
                  }
                ).event;
                if (modelEvent?.type === "modelContentBlockDeltaEvent") {
                  const delta = (
                    modelEvent as {
                      delta?: { type?: string; text?: string };
                    }
                  ).delta;
                  if (delta?.type === "reasoningContentDelta" && delta.text) {
                    setStatus("thinking");
                    appendThoughtText(delta.text);
                  } else if (delta?.type === "textDelta" && delta.text) {
                    finalizeThoughtLine();
                    setStatus("streaming");
                    ensureAssistantLine();
                    appendAssistantText(delta.text);
                  }
                }
                if (modelEvent?.type === "modelMetadataEvent") {
                  const u = (modelEvent.usage ?? {}) as Partial<Usage>;
                  const delta: Usage = {
                    inputTokens: u.inputTokens ?? 0,
                    outputTokens: u.outputTokens ?? 0,
                    totalTokens: u.totalTokens ?? 0,
                    ...(u.cacheReadInputTokens !== undefined && {
                      cacheReadInputTokens: u.cacheReadInputTokens,
                    }),
                    ...(u.cacheWriteInputTokens !== undefined && {
                      cacheWriteInputTokens: u.cacheWriteInputTokens,
                    }),
                  };
                  const metricsData = (modelEvent.metrics ?? {}) as {
                    latencyMs?: number;
                  };
                  const lat = metricsData.latencyMs ?? 0;
                  // Sum every `modelMetadataEvent` for this chat session (Strands meter semantics). Never reset on
                  // new prompts so the footer stays monotonic; note input totals sum per-request prompt sizes.
                  setUsage((prev) => {
                    const tokens: Usage = {
                      inputTokens: prev.inputTokens,
                      outputTokens: prev.outputTokens,
                      totalTokens: prev.totalTokens,
                      ...(prev.cacheReadInputTokens !== undefined && {
                        cacheReadInputTokens: prev.cacheReadInputTokens,
                      }),
                      ...(prev.cacheWriteInputTokens !== undefined && {
                        cacheWriteInputTokens: prev.cacheWriteInputTokens,
                      }),
                    };
                    accumulateUsage(tokens, delta);
                    return { ...tokens, latencyMs: prev.latencyMs + lat };
                  });
                }
                break;
              }
              default:
                break;
            }
          }
        });
      } catch (error) {
        appendLine({
          id: nowId(),
          role: "system",
          title: "error",
          content: error instanceof Error ? error.message : String(error),
          done: true,
        });
      } finally {
        finalizeThoughtLine();
        finalizeAssistantLine();
        for (const toolLineId of toolLineIdsRef.current.values()) {
          updateLine(toolLineId, { phase: "done", done: true });
        }
        for (const toolLineId of pendingToolLineIdsRef.current) {
          updateLine(toolLineId, { phase: "done", done: true });
        }
        toolLineIdsRef.current.clear();
        pendingToolLineIdsRef.current = [];
        runningRef.current = false;
        setRunning(false);
        setTurnStartedAt(null);
        setStatus("ready");
        if (isExitRequested(agent)) {
          onExit();
          exit();
        }
      }
    },
    [
      appendAssistantText,
      appendThoughtText,
      appendLine,
      agent,
      exit,
      ensureAssistantLine,
      finalizeAssistantLine,
      finalizeThoughtLine,
      onExit,
      updateLine,
    ],
  );

  const runTurnRef = useRef(runTurn);
  useEffect(() => {
    runTurnRef.current = runTurn;
  }, [runTurn]);

  const queueRef = useRef<fastq.queueAsPromised<QueuedPrompt, void> | null>(
    null,
  );
  if (!queueRef.current) {
    queueRef.current = fastq.promise(async (item: QueuedPrompt) => {
      if (skippedQueueIdsRef.current.delete(item.id)) {
        return;
      }
      if (mountedRef.current) {
        setQueuedPrompts((prev) =>
          prev.filter((entry) => entry.id !== item.id),
        );
      }
      await runTurnRef.current(item.prompt);
    }, 1);
  }

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      queueRef.current?.kill();
    };
  }, []);

  const pushPrompt = useCallback(
    (value: string | PromptSubmission): boolean => {
      const normalized = normalizePromptSubmission(value);
      const trimmed = normalized.text.trim();
      if (!trimmed && normalized.attachments.length === 0) {
        return false;
      }
      const item: QueuedPrompt = {
        id: nowId(),
        prompt: { ...normalized, text: trimmed },
      };
      setQueuedPrompts((prev) => [...prev, item]);
      void queueRef.current?.push(item).catch((error) => {
        if (!mountedRef.current) {
          return;
        }
        setQueuedPrompts((prev) =>
          prev.filter((entry) => entry.id !== item.id),
        );
        appendLine({
          id: nowId(),
          role: "system",
          title: "error",
          content: error instanceof Error ? error.message : String(error),
          done: true,
        });
      });
      return true;
    },
    [appendLine],
  );

  useEffect(() => {
    if (prompt && !initialRanRef.current) {
      initialRanRef.current = true;
      pushPrompt(prompt);
    }
  }, [prompt, pushPrompt]);

  const onSubmit = useCallback(
    (value: PromptSubmission) => {
      if (pendingApproval) {
        return;
      }
      const trimmed = value.text.trim();
      if (
        runningRef.current &&
        !trimmed &&
        value.attachments.length === 0 &&
        queuedPromptsRef.current.length > 0
      ) {
        const queued = queuedPromptsRef.current;
        queuedPromptsRef.current = [];
        for (const item of queued) {
          skippedQueueIdsRef.current.add(item.id);
        }
        setQueuedPrompts([]);
        if (steering.queue(queued.map((item) => item.prompt))) {
          appendLine({
            id: nowId(),
            role: "system",
            title: "steering",
            content: `Steered the active turn with ${queued.length} queued prompt${
              queued.length === 1 ? "" : "s"
            }.`,
            done: true,
          });
        }
        setInput("");
        return;
      }
      const command = parseChatCommand(value.text);
      if (command && value.attachments.length === 0) {
        if (command.name === "init") {
          if (pushPrompt(INIT_AGENTS_PROMPT)) {
            setInput("");
          }
          return;
        }
        if (command.name === "model") {
          void handleModelCommand(command.args);
          setInput("");
          return;
        }
        if (command.name === "yolo") {
          void handleYoloCommand(command.args);
          setInput("");
          return;
        }
        if (command.name === "mode") {
          void handleModeCommand(command.args);
          setInput("");
          return;
        }
        if (command.name === "effort") {
          void handleEffortCommand(command.args);
          setInput("");
          return;
        }
        if (command.name === "compact") {
          void handleCompactCommand();
          setInput("");
          return;
        }
        if (command.name === "config") {
          handleConfigCommand();
          setInput("");
          return;
        }
        if (command.name === "new") {
          handleNewCommand();
          setInput("");
          return;
        }
        if (command.name === "sessions") {
          void handleSessionsCommand();
          setInput("");
          return;
        }
      }
      if (pushPrompt(value)) {
        setInput("");
      }
    },
    [
      appendLine,
      handleModelCommand,
      handleCompactCommand,
      handleConfigCommand,
      handleEffortCommand,
      handleModeCommand,
      handleNewCommand,
      handleSessionsCommand,
      handleYoloCommand,
      pendingApproval,
      pushPrompt,
      steering,
    ],
  );

  useInput(
    (inputKey, key) => {
      if (isMouseInput(inputKey)) {
        return;
      }
      // Shift+Tab cycles reasoning effort up (wrapping off -> minimal -> low ->
      // medium -> high -> off). The change persists to the active model's
      // provider config and rebuilds the live model. Ctrl/Cmd+,/. can't be
      // detected in a terminal TUI, so Shift+Tab is used instead.
      if (key.tab && key.shift) {
        void cycleReasoningEffort(1);
        return;
      }
      // Scrolling is handled natively by the terminal: finished transcript
      // lines are flushed to real scrollback via <Static>, so the user scrolls
      // with their mouse/trackpad/terminal like any other command output.
      if (key.ctrl && inputKey.toLowerCase() === "c") {
        if (runningRef.current) {
          agent.cancel();
          setStatus("cancel requested");
          return;
        }
        if (picker) {
          setPicker(null);
          return;
        }
        onExit();
        exit();
        return;
      }
      if (key.escape) {
        if (picker) {
          setPicker(null);
          return;
        }
        if (runningRef.current) {
          agent.cancel();
          setStatus("cancel requested");
          return;
        }
        onExit();
        exit();
      }
    },
    // Keep active while a turn runs so Esc / Ctrl+C can call `agent.cancel()`.
    // When `running` was false here, keys never reached this handler during streaming.
    { isActive: !pendingApproval },
  );

  const elapsedLabel = useMemo(() => {
    const seconds = Math.floor(turnElapsedMs / 1000);
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }, [turnElapsedMs]);

  const inputHint =
    running && queuedPrompts.length > 0 ? INPUT_HINT_WITH_STEERING : INPUT_HINT;

  // Split the transcript at the first not-yet-finalized entry. Everything before
  // it is final and append-only, so it can be flushed to the terminal scrollback
  // via <Static> (printed once, never re-rendered). Everything from there on is
  // the live tail that Ink keeps re-rendering: streaming text, running tools,
  // active reasoning. Using the done-prefix (rather than per-line `done`)
  // guarantees Static only ever grows and stays in chronological order even when
  // tools finish out of order.
  const committedCount = useMemo(() => {
    let end = 0;
    while (end < lines.length && lines[end]?.done) {
      end += 1;
    }
    return end;
  }, [lines]);
  const committedLines = useMemo(
    () => lines.slice(0, committedCount),
    [lines, committedCount],
  );
  const liveLines = useMemo(
    () => lines.slice(committedCount),
    [lines, committedCount],
  );

  // Before the first prompt there is nothing in scrollback yet, so grow the live
  // region to the full viewport and vertically center the banner (with the
  // composer pinned to the bottom). Once any line exists the region collapses to
  // its natural height and finished lines flow into the terminal scrollback.
  const isEmpty = lines.length === 0;

  return (
    <Box flexDirection="column" width="100%">
      <Static items={committedLines}>
        {(line) => (
          <Box key={line.id} paddingX={1}>
            <TranscriptLine
              line={line}
              assistantName={config.name}
              reasoningDisplay={config.reasoning}
            />
          </Box>
        )}
      </Static>
      <Box
        flexDirection="column"
        width="100%"
        paddingX={1}
        {...(isEmpty ? { height: Math.max(1, windowSize.rows - 1) } : {})}
      >
        {isEmpty ? (
          <Box flexDirection="column" flexGrow={1} justifyContent="center">
            <EmptyChatBanner />
          </Box>
        ) : null}
        <LiveTranscript
          lines={liveLines}
          assistantName={config.name}
          reasoningDisplay={config.reasoning}
        />
        <BottomChrome
          config={config}
          running={running}
          status={status}
          currentModel={currentModelLabel(config)}
          reasoningEffort={currentReasoningEffort(config)}
          yoloOn={isYoloEnabled(agent)}
          sessionMode={getModeState(agent).mode}
          elapsedLabel={elapsedLabel}
          turnCount={turnCount}
          totalTools={totalTools}
          skillsFound={skillsFound}
          manager={manager}
          mcpNeedsAttention={mcpNeedsAttention}
          usage={usage}
          todoState={todoState}
          queuedPrompts={queuedPrompts}
          pendingApproval={Boolean(pendingApproval)}
          picker={picker}
          sessionItems={sessionItems}
          slashCommands={slashCommands}
          slashHighlightIndex={slashHighlightIndex}
          input={input}
          inputHint={inputHint}
          slashMenu={slashMenu}
          onApprovalDecision={(decision) => approvals.decide(decision)}
          onModelSelect={(name) => {
            setPicker(null);
            void handleModelCommand(name);
          }}
          onEffortSelect={(value) => {
            setPicker(null);
            void handleEffortCommand(value);
          }}
          onYoloSelect={(value) => {
            setPicker(null);
            void handleYoloCommand(value);
          }}
          onModeSelect={(value) => {
            setPicker(null);
            void handleModeCommand(value);
          }}
          onSessionSelect={(value) => {
            setPicker(null);
            handleResumeSessionCommand(value);
          }}
          onInputChange={setInput}
          onSubmit={onSubmit}
        />
      </Box>
    </Box>
  );
}
