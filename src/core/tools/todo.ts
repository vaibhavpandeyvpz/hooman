import { tool } from "@strands-agents/sdk";
import type { JSONValue, ToolContext } from "@strands-agents/sdk";
import { z } from "zod";
import {
  setTodoState,
  summarizeTodos,
  TodoItemSchema,
} from "../state/todos.js";

export const UPDATE_TODOS_TOOL_NAME = "update_todos";

const UpdateTodosInputSchema = z.object({
  todos: z.array(TodoItemSchema),
});

function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
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
        setTodoState(context.agent, todos);
        return toJsonValue({
          todos,
          ...summarizeTodos(todos),
        });
      },
    }),
  ];
}
