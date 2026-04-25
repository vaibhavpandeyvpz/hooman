import { tool } from "@strands-agents/sdk";
import type { JSONValue, ToolContext } from "@strands-agents/sdk";
import { z } from "zod";

export const UPDATE_TODOS_TOOL_NAME = "update_todos";
export const TODO_ITEMS_STATE_KEY = "todo.items";
export const TODO_VISIBLE_STATE_KEY = "todo.visible";

const TodoStatusSchema = z.enum(["pending", "in_progress", "completed"]);

const TodoItemSchema = z.object({
  content: z.string().trim().min(1),
  status: TodoStatusSchema,
  activeForm: z.string().trim().min(1),
});

const UpdateTodosInputSchema = z.object({
  todos: z.array(TodoItemSchema),
});

export type TodoStatus = z.infer<typeof TodoStatusSchema>;
export type TodoItem = z.infer<typeof TodoItemSchema>;

type AppStateLike = {
  get<T = unknown>(key: string): T;
  set(key: string, value: unknown): void;
};

type AgentLike = {
  appState: AppStateLike;
};

export type TodoViewState = {
  visible: boolean;
  todos: TodoItem[];
  total: number;
  pending: number;
  ongoing: number;
  completed: number;
};

function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function normalizeTodoItems(value: unknown): TodoItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized: TodoItem[] = [];
  for (const item of value) {
    const parsed = TodoItemSchema.safeParse(item);
    if (parsed.success) {
      normalized.push(parsed.data);
    }
  }
  return normalized;
}

function summarizeTodos(
  todos: TodoItem[],
): Omit<TodoViewState, "visible" | "todos"> {
  const pending = todos.filter((todo) => todo.status === "pending").length;
  const ongoing = todos.filter((todo) => todo.status === "in_progress").length;
  const completed = todos.filter((todo) => todo.status === "completed").length;
  return {
    total: todos.length,
    pending,
    ongoing,
    completed,
  };
}

export function getTodoViewState(agent: AgentLike): TodoViewState {
  const todos = normalizeTodoItems(agent.appState.get(TODO_ITEMS_STATE_KEY));
  const rawVisible = agent.appState.get(TODO_VISIBLE_STATE_KEY);
  const visible =
    typeof rawVisible === "boolean" ? rawVisible : todos.length > 0;
  const summary = summarizeTodos(todos);
  return {
    visible,
    todos,
    ...summary,
  };
}

export function clearTodoState(agent: AgentLike): void {
  agent.appState.set(TODO_ITEMS_STATE_KEY, []);
  agent.appState.set(TODO_VISIBLE_STATE_KEY, false);
}

export function createTodoTools() {
  return [
    tool({
      name: UPDATE_TODOS_TOOL_NAME,
      description: `Create and update a structured todo list for the current work.
Use this when work has multiple meaningful steps and you need to track progress.
Set items to pending/in_progress/completed as you work and keep the list current.`,
      inputSchema: UpdateTodosInputSchema,
      callback: async (
        input: z.infer<typeof UpdateTodosInputSchema>,
        context?: ToolContext,
      ) => {
        if (!context) {
          throw new Error("update_todos requires execution context.");
        }
        const todos = input.todos.map((todo) => TodoItemSchema.parse(todo));
        context.agent.appState.set(TODO_ITEMS_STATE_KEY, todos);
        context.agent.appState.set(TODO_VISIBLE_STATE_KEY, todos.length > 0);
        return toJsonValue({
          todos,
          ...summarizeTodos(todos),
        });
      },
    }),
  ];
}
