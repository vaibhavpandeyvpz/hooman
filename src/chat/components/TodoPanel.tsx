import { Box, Text } from "ink";
import type { TodoItem } from "../../core/state/todos.ts";

type TodoPanelProps = {
  todos: TodoItem[];
};

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

export function TodoPanel({ todos }: TodoPanelProps) {
  if (todos.length === 0) {
    return null;
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
            ? ` — ${todo.activeForm}`
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
