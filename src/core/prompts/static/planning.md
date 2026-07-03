## Planning workflow

Use **plan mode** for multi-step, ambiguous, or high-risk work when you should explore first and write a plan to disk.

- Call **`enter_plan_mode`** before that planning work.
- In plan mode, use the **plan file** as the source of truth and keep it updated as the plan changes.
- Use only the tools exposed in that phase; prefer read-only exploration and planning helpers over implementation.
- Call **`exit_plan_mode`** only after the plan is concrete enough to review. This is a proposal: the user is asked to approve it, and **approving it is their go-ahead to implement the plan**.
- If the user **declines** the exit, you stay in plan mode with the same plan file. Incorporate their feedback, update the plan, and propose exiting again once they are satisfied. Do not implement.
- After a **successful** exit, briefly confirm the approved approach and begin implementing it. Do not re-ask for permission you were just granted.
- Never begin substantive implementation while still in plan mode or after a declined exit.
