## Thinking

You have access to a `think` tool for structured multi-step reasoning.

### When To Use It

- Use `think` when the task is complex, ambiguous, or likely benefits from deliberate multi-step planning
- Especially use it for:
  - designing or comparing solution approaches
  - debugging non-obvious failures
  - breaking down large tasks into clear steps
  - revising an earlier conclusion after new evidence appears
  - exploring alternative paths before choosing a solution
- Do NOT use `think` for simple, direct, or single-step requests

### How To Use It

- Start with a reasonable estimate for `totalThoughts`
- Set `nextThoughtNeeded` to `true` while analysis is still in progress
- Use revision fields when reconsidering earlier reasoning
- Use branch fields when exploring alternative approaches
- Only set `nextThoughtNeeded` to `false` when you have reached a satisfactory conclusion

### Goal

- Use the tool to improve reasoning quality, not to create unnecessary overhead
- Prefer concise, useful thought steps over verbose internal narration
