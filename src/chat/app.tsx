import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import fastq from "fastq";
import { Box, useApp, useInput, useWindowSize } from "ink";
import {
  Message,
  TextBlock,
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
  BUILTIN_AGENT_CONFIGS,
  getBuiltInAgentConfig,
  isBuiltInAgentId,
} from "../core/agents/index.js";
import type { Registry } from "../core/skills/index.js";
import { takeFileToolDisplay } from "../core/state/file-tool-display.js";
import { ChatApprovalController } from "./approvals.js";
import { ChatTurnSteeringController } from "./steering.js";
import { ApprovalPrompt } from "./components/ApprovalPrompt.js";
import { Composer } from "./components/Composer.js";
import { SelectPicker } from "./components/SelectPicker.js";
import { QueuedPrompts } from "./components/QueuedPrompts.js";
import { SlashCommands } from "./components/SlashCommands.js";
import { StatusBar } from "./components/StatusBar.js";
import { TodoPanel } from "./components/TodoPanel.js";
import { TranscriptViewport } from "./components/TranscriptViewport.js";
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
import { attachmentPathsToPromptBlocks } from "../core/utils/attachments.js";
import { isMouseInput } from "./mouse.js";
import type { PromptSubmission } from "./components/prompt-input/hooks/usePromptInputController.js";
import { readBundledPrompt } from "../core/prompts/bundled.js";
import { runWithAgentMemoryScope } from "../core/memory/index.js";

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

function stringifyUnknown(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
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
  if (isBuiltInAgentId(t)) {
    return t;
  }
  return undefined;
}

function sessionModeLabel(mode: SessionMode): string {
  return getBuiltInAgentConfig(mode)?.name ?? mode;
}

function listModelsText(config: Config): string {
  const current = currentModelName(config);
  const options = config.llms.map((entry) => {
    const marker = entry.name === current ? "*" : "-";
    const resolved = config.resolveLlm(entry.name);
    if (!resolved) {
      return `${marker} ${entry.name} (${entry.options.provider}/${entry.options.model})`;
    }
    return `${marker} ${entry.name} (${entry.options.provider} -> ${resolved.options.provider}/${resolved.options.model})`;
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
    name: "init",
    description: "Generate or refresh AGENTS.md for this project.",
  },
  {
    name: "mode",
    description: "Session mode: Default or a built-in agent profile.",
  },
  {
    name: "model",
    description: "Pick or set the chat model.",
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
}: ChatAppProps): React.JSX.Element {
  const { exit } = useApp();
  const { rows } = useWindowSize();
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("ready");
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [turnCount, setTurnCount] = useState(0);
  const [skillsFound, setSkillsFound] = useState(0);
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const [turnElapsedMs, setTurnElapsedMs] = useState(0);
  const [usage, setUsage] = useState<TurnUsageStatus>(emptyTurnUsage);
  const [pendingApproval, setPendingApproval] =
    useState<ApprovalRequest | null>(null);
  const [picker, setPicker] = useState<null | "model" | "yolo" | "mode">(null);
  /** Forces StatusBar to re-read yolo/mode from agent when those change without a picker close or rebuild. */
  const [, setSessionChromeEpoch] = useState(0);
  const bumpSessionChrome = useCallback(() => {
    setSessionChromeEpoch((n) => n + 1);
  }, []);
  const [slashHighlightIndex, setSlashHighlightIndex] = useState(0);
  const [queuedPrompts, setQueuedPrompts] = useState<QueuedPrompt[]>([]);
  const [liveReasoning, setLiveReasoning] = useState("");
  const [followRequest, setFollowRequest] = useState(0);
  const [todoState, setTodoState] = useState<TodoViewState>(() =>
    getTodoViewState(agent),
  );
  const mountedRef = useRef(true);
  const runningRef = useRef(false);
  const assistantLineIdRef = useRef<string | null>(null);
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

  const moveLineToEnd = useCallback((id: string) => {
    setLines((prev) => {
      const index = prev.findIndex((line) => line.id === id);
      if (index === -1 || index === prev.length - 1) {
        return prev;
      }
      const next = [...prev];
      const [line] = next.splice(index, 1);
      if (!line) {
        return prev;
      }
      next.push(line);
      return next;
    });
  }, []);

  const appendAssistantText = useCallback((text: string) => {
    const id = assistantLineIdRef.current;
    if (!id) {
      return;
    }
    setLines((prev) =>
      prev.map((line) =>
        line.id === id ? { ...line, content: `${line.content}${text}` } : line,
      ),
    );
  }, []);

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
        const provider = await modelProviders[config.llm.provider]!();
        agent.model = provider.create(config.llm.model, config.llm.params);
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
          content: `Unknown mode "${trimmed}". Use default or one of the built-in mode ids, or open the picker with /mode.`,
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
      setLiveReasoning("");
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

      const assistantId = nowId();
      assistantLineIdRef.current = assistantId;
      appendLine({
        id: assistantId,
        role: "assistant",
        content: "",
        done: false,
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
                  appendAssistantText(block.text ?? "");
                } else if (block.type === "toolUseBlock") {
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
                  if (assistantLineIdRef.current) {
                    moveLineToEnd(assistantLineIdRef.current);
                  }
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
                    setLiveReasoning((prev) => `${prev}${delta.text}`);
                  } else if (delta?.type === "textDelta") {
                    setStatus("streaming");
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
        updateLine(assistantId, { done: true });
        assistantLineIdRef.current = null;
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
        setLiveReasoning("");
        setStatus("ready");
        if (isExitRequested(agent)) {
          onExit();
          exit();
        }
      }
    },
    [
      appendAssistantText,
      appendLine,
      agent,
      exit,
      moveLineToEnd,
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
          setFollowRequest((value) => value + 1);
        }
        setInput("");
        return;
      }
      const command = parseChatCommand(value.text);
      if (command && value.attachments.length === 0) {
        if (command.name === "init") {
          if (pushPrompt(INIT_AGENTS_PROMPT)) {
            setFollowRequest((value) => value + 1);
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
      }
      if (pushPrompt(value)) {
        setFollowRequest((value) => value + 1);
        setInput("");
      }
    },
    [
      appendLine,
      handleModelCommand,
      handleModeCommand,
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

  const activeTodo = useMemo(
    () => todoState.todos.find((todo) => todo.status === "in_progress"),
    [todoState.todos],
  );
  const statusLabel =
    running && activeTodo
      ? activeTodo.activeForm.trim() || activeTodo.content
      : status;
  const inputHint =
    running && queuedPrompts.length > 0 ? INPUT_HINT_WITH_STEERING : INPUT_HINT;

  return (
    <Box flexDirection="column" width="100%" height={rows} paddingX={1}>
      <TranscriptViewport
        lines={lines}
        liveReasoning={liveReasoning}
        followRequest={followRequest}
      />

      <Box flexDirection="column" flexShrink={0}>
        {running && todoState.visible && todoState.todos.length > 0 ? (
          <TodoPanel todos={todoState.todos} />
        ) : null}
        <QueuedPrompts prompts={queuedPrompts} />

        {pendingApproval ? (
          <ApprovalPrompt
            onDecision={(decision) => approvals.decide(decision)}
          />
        ) : null}

        {!pendingApproval && picker === "model" ? (
          <SelectPicker
            title="Choose model"
            items={config.llms.map((entry) => ({
              label: `${entry.name} • ${entry.options.provider}/${entry.options.model}${entry.default ? " • current" : ""}`,
              value: entry.name,
            }))}
            onSelect={(name) => {
              setPicker(null);
              void handleModelCommand(name);
            }}
          />
        ) : null}

        {!pendingApproval && picker === "yolo" ? (
          <SelectPicker
            title="Auto-approve tools (yolo)"
            items={[
              {
                label: `Off • confirm each tool${
                  !isYoloEnabled(agent) ? " • current" : ""
                }`,
                value: "off",
              },
              {
                label: `On • run tools without prompts${
                  isYoloEnabled(agent) ? " • current" : ""
                }`,
                value: "on",
              },
            ]}
            onSelect={(v) => {
              setPicker(null);
              void handleYoloCommand(v);
            }}
          />
        ) : null}

        {!pendingApproval && picker === "mode" ? (
          <SelectPicker
            title="Session mode"
            items={[
              ...BUILTIN_AGENT_CONFIGS.map((entry) => ({
                label: `${entry.name} • ${entry.description}${
                  getModeState(agent).mode === entry.id ? " • current" : ""
                }`,
                value: entry.id,
              })),
            ]}
            onSelect={(v) => {
              setPicker(null);
              void handleModeCommand(v);
            }}
          />
        ) : null}

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
            disabled={Boolean(pendingApproval)}
            hint={inputHint}
            onChange={setInput}
            onSubmit={onSubmit}
            slashMenu={slashMenu}
          />
        ) : null}

        <StatusBar
          running={running}
          status={status}
          statusLabel={statusLabel}
          sessionId={sessionId}
          currentModel={currentModelLabel(config)}
          yoloOn={isYoloEnabled(agent)}
          sessionMode={sessionModeLabel(getModeState(agent).mode)}
          elapsedLabel={elapsedLabel}
          turnCount={turnCount}
          totalTools={totalTools}
          skillsFound={skillsFound}
          manager={manager}
          usage={usage}
        />
      </Box>
    </Box>
  );
}
