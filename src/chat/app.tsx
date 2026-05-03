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
  BeforeToolCallEvent,
  Message,
  TextBlock,
  type Agent,
  type AgentStreamEvent,
  type ContentBlock,
  type MessageData,
} from "@strands-agents/sdk";
import { bootstrap } from "../core/index.js";
import type { Config } from "../core/config.js";
import type { Manager as McpManager } from "../core/mcp/index.js";
import type { Registry } from "../core/skills/index.js";
import { takeFileToolDisplay } from "../core/state/file-tool-display.js";
import {
  ChatApprovalController,
  createChatApprovalHandler,
} from "./approvals.js";
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
import { copyAgentAppState } from "../core/state/agent-app-state.js";
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

type ChatAppProps = {
  agent: Agent;
  config: Config;
  sessionId: string;
  manager: McpManager;
  registry: Registry;
  initialPrompt?: string;
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
  if (t === "default" || t === "plan" || t === "ask") {
    return t;
  }
  return undefined;
}

function listModelsText(config: Config): string {
  const current = currentModelName(config);
  const options = config.llms.map((entry) => {
    const marker = entry.name === current ? "*" : "-";
    return `${marker} ${entry.name} (${entry.options.provider}/${entry.options.model})`;
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
    name: "mode",
    description: "Session mode: default, plan, or ask.",
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
  initialPrompt,
  onExit,
}: ChatAppProps): React.JSX.Element {
  const { exit } = useApp();
  const { rows } = useWindowSize();
  const [currentAgent, setCurrentAgent] = useState(agent);
  const [currentManager, setCurrentManager] = useState(manager);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("ready");
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [turnCount, setTurnCount] = useState(0);
  const [skillsFound, setSkillsFound] = useState(0);
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const [turnElapsedMs, setTurnElapsedMs] = useState(0);
  const [usage, setUsage] = useState({
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    latencyMs: 0,
  });
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
  const controllerRef = useRef(new ChatApprovalController());
  const mountedRef = useRef(true);
  const runningRef = useRef(false);
  const assistantLineIdRef = useRef<string | null>(null);
  const toolLineIdsRef = useRef(new Map<string, string>());
  const pendingToolLineIdsRef = useRef<string[]>([]);
  const initialRanRef = useRef(false);

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
    const controller = controllerRef.current;
    const cleanupListener = controller.subscribe(() => {
      setPendingApproval(controller.pending);
    });
    const cleanupHook = currentAgent.addHook(
      BeforeToolCallEvent,
      createChatApprovalHandler(controller),
    );
    return () => {
      cleanupListener();
      cleanupHook();
    };
  }, [currentAgent]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (!active) {
        return;
      }
      setTodoState(getTodoViewState(currentAgent));
    };
    refresh();
    const timer = setInterval(refresh, running ? 200 : 800);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [currentAgent, running]);

  const totalTools =
    (currentAgent as Agent & { tools?: unknown[] }).tools?.length ?? 0;
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

  const rebuildAgent = useCallback(async () => {
    const messageSnapshot: MessageData[] = currentAgent.messages.map(
      (message) => message.toJSON(),
    );
    const {
      agent: nextAgent,
      mcp: { manager: nextManager },
    } = await bootstrap(
      "default",
      { sessionId, yolo: isYoloEnabled(currentAgent) },
      false,
      config,
    );
    nextAgent.messages.length = 0;
    for (const message of messageSnapshot) {
      nextAgent.messages.push(Message.fromJSON(message));
    }
    copyAgentAppState(currentAgent, nextAgent);
    applySessionMode(nextAgent);
    setCurrentAgent(nextAgent);
    setCurrentManager(nextManager);
    await currentManager.disconnect();
  }, [config, currentAgent, currentManager, sessionId]);

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
        await rebuildAgent();
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
    [appendLine, config, rebuildAgent],
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
      const prev = isYoloEnabled(currentAgent);
      if (prev === enabled) {
        return;
      }
      setYoloEnabled(currentAgent, enabled);
      bumpSessionChrome();
    },
    [appendLine, bumpSessionChrome, currentAgent],
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
          content: `Unknown mode "${trimmed}". Use default, plan, or ask, or open the picker with /mode.`,
          done: true,
        });
        return;
      }
      const prev = getModeState(currentAgent).mode;
      if (prev === mode) {
        return;
      }
      setSessionMode(currentAgent, mode);
      applySessionMode(currentAgent);
      bumpSessionChrome();
    },
    [appendLine, bumpSessionChrome, currentAgent],
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
        for await (const event of currentAgent.stream(streamInput)) {
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
                currentAgent.appState,
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
                  event?: { type?: string; usage?: unknown; metrics?: unknown };
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
                const usageData = (modelEvent.usage ?? {}) as {
                  inputTokens?: number;
                  outputTokens?: number;
                  totalTokens?: number;
                };
                const metricsData = (modelEvent.metrics ?? {}) as {
                  latencyMs?: number;
                };
                setUsage({
                  inputTokens: usageData.inputTokens ?? 0,
                  outputTokens: usageData.outputTokens ?? 0,
                  totalTokens: usageData.totalTokens ?? 0,
                  latencyMs: metricsData.latencyMs ?? 0,
                });
              }
              break;
            }
            default:
              break;
          }
        }
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
        if (isExitRequested(currentAgent)) {
          onExit();
          exit();
        }
      }
    },
    [
      appendAssistantText,
      appendLine,
      currentAgent,
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
    if (initialPrompt && !initialRanRef.current) {
      initialRanRef.current = true;
      pushPrompt(initialPrompt);
    }
  }, [initialPrompt, pushPrompt]);

  const onSubmit = useCallback(
    (value: PromptSubmission) => {
      if (pendingApproval) {
        return;
      }
      const command = parseChatCommand(value.text);
      if (command && value.attachments.length === 0) {
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
      handleModelCommand,
      handleModeCommand,
      handleYoloCommand,
      pendingApproval,
      pushPrompt,
    ],
  );

  useInput(
    (inputKey, key) => {
      if (isMouseInput(inputKey)) {
        return;
      }
      if (key.ctrl && inputKey.toLowerCase() === "c") {
        if (runningRef.current) {
          currentAgent.cancel();
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
          currentAgent.cancel();
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
            onDecision={(decision) => controllerRef.current.decide(decision)}
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
                  !isYoloEnabled(currentAgent) ? " • current" : ""
                }`,
                value: "off",
              },
              {
                label: `On • run tools without prompts${
                  isYoloEnabled(currentAgent) ? " • current" : ""
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
              {
                label: `Default • full tool surface${
                  getModeState(currentAgent).mode === "default"
                    ? " • current"
                    : ""
                }`,
                value: "default",
              },
              {
                label: `Plan • read only tools + plan file${
                  getModeState(currentAgent).mode === "plan" ? " • current" : ""
                }`,
                value: "plan",
              },
              {
                label: `Ask • read only tools, no plan workflow${
                  getModeState(currentAgent).mode === "ask" ? " • current" : ""
                }`,
                value: "ask",
              },
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
            hint={INPUT_HINT}
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
          yoloOn={isYoloEnabled(currentAgent)}
          sessionMode={getModeState(currentAgent).mode}
          elapsedLabel={elapsedLabel}
          turnCount={turnCount}
          totalTools={totalTools}
          skillsFound={skillsFound}
          manager={currentManager}
          usage={usage}
        />
      </Box>
    </Box>
  );
}
