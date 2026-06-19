import { Box, Text, useStdout } from "ink";
import type { TodoItem } from "../../core/state/todos.js";

type TodoPanelProps = {
  todos: TodoItem[];
};

const MIN_COMPACT_PREVIEW_CHARS = 24;
const MAX_PANEL_TERMINAL_SHARE = 0.2;
const COMPACT_PREFIX_RESERVE = 10;

function markerForStatus(status: TodoItem["status"]): string {
  switch (status) {
    case "completed":
      return "[x]";
    case "in_progress":
      return "[~]";
    case "pending":
      return "[ ]";
  }
}

function estimateWrappedLines(text: string, columns: number): number {
  const width = Math.max(1, columns);
  return Math.max(1, Math.ceil(text.length / width));
}

function truncateSingleLine(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  if (maxChars <= 3) {
    return ".".repeat(Math.max(0, maxChars));
  }
  return `${text.slice(0, maxChars - 3)}...`;
}

function findActiveTodo(todos: TodoItem[]): { todo: TodoItem; index: number } {
  const inProgressIndex = todos.findIndex((todo) => todo.status === "in_progress");
  if (inProgressIndex >= 0) {
    return { todo: todos[inProgressIndex]!, index: inProgressIndex };
  }

  const pendingIndex = todos.findIndex((todo) => todo.status === "pending");
  if (pendingIndex >= 0) {
    return { todo: todos[pendingIndex]!, index: pendingIndex };
  }

  return { todo: todos[todos.length - 1]!, index: todos.length - 1 };
}

export function TodoPanel({ todos }: TodoPanelProps) {
  const { stdout } = useStdout();

  if (todos.length === 0) {
    return null;
  }

  const columns = stdout?.columns ?? 80;
  const rows = stdout?.rows ?? 24;
  const fullRowEstimate =
    1 +
    todos.reduce((count, todo, index) => {
      const inProgress = todo.status === "in_progress";
      const suffix =
        inProgress && todo.activeForm.trim().length > 0
          ? ` - ${todo.activeForm}`
          : "";
      const line = `${index + 1}. ${markerForStatus(todo.status)} ${todo.content}${suffix}`;
      return count + estimateWrappedLines(line, columns);
    }, 0);
  const shouldCollapse = fullRowEstimate > rows * MAX_PANEL_TERMINAL_SHARE;

  if (shouldCollapse) {
    const { todo, index } = findActiveTodo(todos);
    const marker = markerForStatus(todo.status);
    const activeText =
      todo.status === "in_progress" && todo.activeForm.trim().length > 0
        ? todo.activeForm
        : todo.content;
    const prefix = `${index + 1}/${todos.length} ${marker} `;
    const preview = truncateSingleLine(
      activeText,
      Math.max(MIN_COMPACT_PREVIEW_CHARS, columns - prefix.length - COMPACT_PREFIX_RESERVE),
    );

    return (
      <Box marginTop={1}>
        <Text bold color={todo.status === "completed" ? "green" : "cyan"}>
          {`${prefix}${preview}`}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">
        Todos
      </Text>
      {todos.map((todo, index) => {
        const completed = todo.status === "completed";
        const inProgress = todo.status === "in_progress";
        const marker = markerForStatus(todo.status);
        const suffix =
          inProgress && todo.activeForm.trim().length > 0
            ? ` - ${todo.activeForm}`
            : "";
        return (
          <Text
            key={`${index}-${todo.content}`}
            dimColor={completed}
            bold={inProgress}
          >
            {`${index + 1}. ${marker} ${todo.content}${suffix}`}
          </Text>
        );
      })}
    </Box>
  );
}
