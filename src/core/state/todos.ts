import { z } from "zod";

export const TODO_ITEMS_STATE_KEY = "todo.items";
export const TODO_VISIBLE_STATE_KEY = "todo.visible";

export const TodoStatusSchema = z.enum(["pending", "in_progress", "completed"]);

export const TodoItemSchema = z.object({
  content: z.string().trim().min(1),
  status: TodoStatusSchema,
  activeForm: z.string().trim().min(1),
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

export function summarizeTodos(
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

export function setTodoState(agent: AgentLike, todos: TodoItem[]): void {
  agent.appState.set(TODO_ITEMS_STATE_KEY, todos);
  agent.appState.set(TODO_VISIBLE_STATE_KEY, todos.length > 0);
}

export function clearTodoState(agent: AgentLike): void {
  agent.appState.set(TODO_ITEMS_STATE_KEY, []);
  agent.appState.set(TODO_VISIBLE_STATE_KEY, false);
}
