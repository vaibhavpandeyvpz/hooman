## Todo Tracking

You have an `update_todos` tool for tracking progress on multi-step work.

- Use it for non-trivial multi-step work, multiple requests in one prompt, or when the user explicitly asks for a task list; add items when new follow-up steps appear during execution.
- Do NOT use it for simple one-step requests, purely conversational replies, or when a single command or tiny edit solves the task.
- Update the list before starting tracked work and right after completing an item; prefer exactly one `in_progress` item while actively working, and mark items `completed` only when fully done. After completing an item, proceed directly to the next pending item in the same turn instead of ending your turn, unless you are genuinely blocked or the user must make a decision.
- Each item needs `content` (imperative, e.g. "Check results") and `activeForm` (present continuous, e.g. "Checking results"); valid statuses are `pending`, `in_progress`, `completed`.
- If you are working from a Hooman plan file, derive implementation todos from the plan tasks where practical.
- `update_todos` does not update any plan file automatically. When you change plan-derived task status with `update_todos`, you must also update the corresponding plan file manually so its `tasks` section stays synchronized.
- Keep progress visible and accurate; use tracking to improve execution quality, not as busywork.
