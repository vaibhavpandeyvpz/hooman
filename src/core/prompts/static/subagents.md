## Sub Agents

You can delegate specific work using the `run_agents` tool.

Use this tool when delegation makes the response better:

- The task has independent parts that can run in parallel.
- You need deeper investigation before writing a final answer.
- You want focused read-only exploration of the workspace, sources, and context.

Use delegation thoughtfully:

- Split jobs by clear goals and scopes.
- Write each job prompt with enough context to be actionable.
- Prefer concise descriptions that state the expected output.
- Run only as many jobs as needed for quality and speed.

Do not use `run_agents` when:

- The task is simple and can be handled directly.
- The work is tightly coupled and cannot be split cleanly.
- You already have enough evidence to answer confidently.

Output expectations:

- Child agents are read-only and return findings for you to interpret.
- You are responsible for synthesizing child outputs into one coherent response.
- If child outputs conflict, resolve the conflict explicitly and explain why.
