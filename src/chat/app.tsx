import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box, useApp, useInput } from "ink";
import {
  BeforeToolCallEvent,
  type Agent,
  type AgentStreamEvent,
} from "@strands-agents/sdk";
import type { Config } from "../core/config.ts";
import type { Manager as McpManager } from "../core/mcp/index.ts";
import {
  ChatApprovalController,
  createChatApprovalHandler,
} from "./approvals.ts";
import { ApprovalPrompt } from "./components/ApprovalPrompt.tsx";
import { Composer } from "./components/Composer.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { Transcript } from "./components/Transcript.tsx";
import type { ApprovalRequest, ChatLine } from "./types.ts";

type ChatAppProps = {
  agent: Agent;
  config: Config;
  sessionId: string;
  manager: McpManager;
  initialPrompt?: string;
  onExit: () => void;
};

const INPUT_HINT = "enter: send | esc/ctrl+c: cancel or exit";

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

export function ChatApp({
  agent,
  config,
  sessionId,
  manager,
  initialPrompt,
  onExit,
}: ChatAppProps): React.JSX.Element {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("ready");
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [turnCount, setTurnCount] = useState(0);
  const [toolCalls, setToolCalls] = useState(0);
  const [mcpToolsFound, setMcpToolsFound] = useState(0);
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
  const [liveReasoning, setLiveReasoning] = useState("");
  const controllerRef = useRef(new ChatApprovalController());
  const runningRef = useRef(false);
  const assistantLineIdRef = useRef<string | null>(null);
  const toolLineIdRef = useRef<string | null>(null);
  const initialRanRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void manager.listPrefixedTools().then((tools) => {
      if (!cancelled) {
        setMcpToolsFound(tools.length);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [manager]);

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
      createChatApprovalHandler(config, controller),
    );
    return () => {
      cleanupListener();
      cleanupHook();
    };
  }, [agent, config]);

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
      if (!trimmed || runningRef.current) {
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
                setToolCalls((value) => value + 1);
                const toolId = nowId();
                toolLineIdRef.current = toolId;
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
              setToolCalls((value) => Math.max(0, value - 1));
              const resultContent = toToolResultText(e.result);
              if (toolLineIdRef.current) {
                updateLine(toolLineIdRef.current, {
                  phase: "done",
                  done: true,
                  resultContent,
                });
                toolLineIdRef.current = null;
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
        if (toolLineIdRef.current) {
          updateLine(toolLineIdRef.current, { phase: "done", done: true });
          toolLineIdRef.current = null;
        }
        runningRef.current = false;
        setRunning(false);
        setTurnStartedAt(null);
        setLiveReasoning("");
        setStatus("ready");
      }
    },
    [agent, appendAssistantText, appendLine, moveLineToEnd, updateLine],
  );

  useEffect(() => {
    if (initialPrompt && !initialRanRef.current) {
      initialRanRef.current = true;
      void runTurn(initialPrompt);
    }
  }, [initialPrompt, runTurn]);

  const onSubmit = useCallback(
    (value: string) => {
      if (running || pendingApproval) {
        return;
      }
      setInput("");
      void runTurn(value);
    },
    [pendingApproval, runTurn, running],
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

  return (
    <Box flexDirection="column" width="100%" paddingX={1}>
      <Transcript lines={lines} liveReasoning={liveReasoning} />

      {pendingApproval ? (
        <ApprovalPrompt
          onDecision={(decision) => controllerRef.current.decide(decision)}
        />
      ) : null}

      {!pendingApproval ? (
        <Composer
          input={input}
          running={running}
          disabled={running || Boolean(pendingApproval)}
          hint={INPUT_HINT}
          onChange={setInput}
          onSubmit={onSubmit}
        />
      ) : null}

      <StatusBar
        running={running}
        status={status}
        sessionId={sessionId}
        elapsedLabel={elapsedLabel}
        turnCount={turnCount}
        toolsFound={mcpToolsFound}
        toolCalls={toolCalls}
        manager={manager}
        usage={usage}
      />
    </Box>
  );
}
