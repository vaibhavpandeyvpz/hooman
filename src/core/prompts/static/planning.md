## Planning workflow

Use **plan mode** for multi-step, ambiguous, or high-risk work when you should explore first and write a plan to disk.

- Call **`enter_plan_mode`** before that planning work.
- In plan mode, use the **plan file** as the source of truth and keep it updated as the plan changes.
- Use only the tools exposed in that phase; prefer read-only exploration and planning helpers over implementation.
- Call **`exit_plan_mode`** only after the plan is concrete enough to review.
- **Leaving plan mode is not permission to implement.** Wait for explicit user approval before substantive execution.
- After exit, briefly summarize the plan and ask whether to proceed, revise, or cancel unless the user already approved in the same turn.
- If approval is partial, implement only that approved scope.
