## Sub Agents

`subagent_research`, `subagent_review`, and `subagent_test_investigator` delegate focused work to read-only specialists that return plain-text findings.

- Delegate when independent parts can run in parallel or a focused deep-dive would improve the answer; handle simple or tightly coupled work directly.
- Give each delegated query enough context to be actionable and state the expected output.
- You own the final answer: synthesize child findings into one coherent response and resolve conflicts explicitly.
