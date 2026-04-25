import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import fastq from "fastq";
import { Box, useApp, useInput } from "ink";
import {
  BeforeToolCallEvent,
  type Agent,
  type AgentStreamEvent,
} from "@strands-agents/sdk";
import type { Manager as McpManager } from "../core/mcp/index.ts";
import type { Registry } from "../core/skills/index.ts";
import {
  ChatApprovalController,
  createChatApprovalHandler,
} from "./approvals.ts";
import { ApprovalPrompt } from "./components/ApprovalPrompt.tsx";
import { Composer } from "./components/Composer.tsx";
import { QueuedPrompts } from "./components/QueuedPrompts.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { TodoPanel } from "./components/TodoPanel.tsx";
import { Transcript } from "./components/Transcript.tsx";
import type { ApprovalRequest, ChatLine } from "./types.ts";
import { getTodoViewState, type TodoViewState } from "../core/tools/todo.ts";

type ChatAppProps = {
  agent: Agent;
  sessionId: string;
  manager: McpManager;
  registry: Registry;
  initialPrompt?: string;
  yolo?: boolean;
  onExit: () => void;
};

type QueuedPrompt = {
  id: string;
  prompt: string;
};

const INPUT_HINT =
  "enter: queue prompt | shift/meta+enter or \\+enter: newline | esc/ctrl+c: cancel or exit";

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

export function ChatApp({
  agent,
  sessionId,
  manager,
  registry,
  initialPrompt,
  yolo,
  onExit,
}: ChatAppProps): React.JSX.Element {
  const { exit } = useApp();
  const totalTools =
    (agent as Agent & { tools?: unknown[] }).tools?.length ?? 0;
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
  const [queuedPrompts, setQueuedPrompts] = useState<QueuedPrompt[]>([]);
  const [liveReasoning, setLiveReasoning] = useState("");
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
    const cleanupHook = agent.addHook(
      BeforeToolCallEvent,
      createChatApprovalHandler(controller, { yolo }),
    );
    return () => {
      cleanupListener();
      cleanupHook();
    };
  }, [agent, yolo]);

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

  const runTurn = useCallback(
    async (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed) {
        return;
      }

      runningRef.current = true;
      setRunning(true);
      setStatus("thinking");
      setTurnStartedAt(Date.now());
      setLiveReasoning("");
      setTurnCount((value) => value + 1);
      appendLine({
        id: nowId(),
        role: "user",
        content: trimmed,
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
        for await (const event of agent.stream(trimmed)) {
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
                });
              } else {
                appendLine({
                  id: nowId(),
                  role: "tool",
                  title: "tool",
                  toolName: "unknown",
                  content: "",
                  resultContent,
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
      }
    },
    [agent, appendAssistantText, appendLine, moveLineToEnd, updateLine],
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
    (value: string): boolean => {
      const trimmed = value.trim();
      if (!trimmed) {
        return false;
      }
      const item: QueuedPrompt = { id: nowId(), prompt: trimmed };
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
    (value: string) => {
      if (pendingApproval) {
        return;
      }
      if (pushPrompt(value)) {
        setInput("");
      }
    },
    [pendingApproval, pushPrompt],
  );

  useInput(
    (inputKey, key) => {
      if (key.ctrl && inputKey.toLowerCase() === "c") {
        if (runningRef.current) {
          agent.cancel();
          setStatus("cancel requested");
          return;
        }
        onExit();
        exit();
        return;
      }
      if (key.escape) {
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

  return (
    <Box flexDirection="column" width="100%" paddingX={1}>
      <Transcript lines={lines} liveReasoning={liveReasoning} />
      {running && todoState.visible && todoState.todos.length > 0 ? (
        <TodoPanel todos={todoState.todos} />
      ) : null}
      <QueuedPrompts prompts={queuedPrompts} />

      {pendingApproval ? (
        <ApprovalPrompt
          onDecision={(decision) => controllerRef.current.decide(decision)}
        />
      ) : null}

      {!pendingApproval ? (
        <Composer
          input={input}
          running={running}
          disabled={Boolean(pendingApproval)}
          hint={INPUT_HINT}
          onChange={setInput}
          onSubmit={onSubmit}
        />
      ) : null}

      <StatusBar
        running={running}
        status={status}
        statusLabel={statusLabel}
        sessionId={sessionId}
        elapsedLabel={elapsedLabel}
        turnCount={turnCount}
        totalTools={totalTools}
        skillsFound={skillsFound}
        manager={manager}
        usage={usage}
      />
    </Box>
  );
}
