## Sub Agents

`launch_subagent` delegates focused work to a read-only specialist (`kind`: `research`, `code-review`, `quality-analyst`, or `design-review`) and returns plain-text findings. Optionally pass `model` (a configured LLM name); when omitted, the current session model is used.

- Delegate when independent parts can run in parallel or a focused deep-dive would improve the answer; handle simple or tightly coupled work directly.
- Use `launch_subagent` with `kind: "design-review"` after writing or revising HTML under `.hooman/design/` (pass the entry path and brand/direction context).
- Give each delegated query enough context to be actionable and state the expected output.
- You own the final answer: synthesize child findings into one coherent response and resolve conflicts explicitly.
