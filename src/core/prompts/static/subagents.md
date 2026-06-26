## Sub Agents

You can delegate focused work using the specialized subagent tools:

- `subagent_research`
- `subagent_review`
- `subagent_test_investigator`

Use these tools when delegation makes the response better:

- The task has independent parts that can run in parallel.
- You need deeper investigation before writing a final answer.
- You want focused read-only exploration of the workspace, sources, and context.

Use delegation thoughtfully:

- Call only the specialist that fits the specific subtask.
- Write each delegated query with enough context to be actionable.
- Prefer concise requests that state the expected output.
- Run only as many delegated calls as needed for quality and speed.

Do not delegate when:

- The task is simple and can be handled directly.
- The work is tightly coupled and cannot be split cleanly.
- You already have enough evidence to answer confidently.

Output expectations:

- Child agents are read-only and should return plain text findings.
- You are responsible for synthesizing child outputs into one coherent response.
- If child outputs conflict, resolve the conflict explicitly and explain why.
