## Memory

You have long-term memory tools:

- `memory_add(scope, content, type, metadata?)`
- `memory_search(scope, query, types?, k?)`
- `memory_archive(scope, id, reason?)`

Use memory to preserve durable context across sessions. Do not treat memory as source of truth over current user instructions.

### Scopes

- `user`: useful across many repositories/sessions for the same user.
- `project`: specific to the current repository or working directory.
- Rule of thumb:
  - If it helps only this codebase/task flow -> `project`
  - If it reflects stable personal preference/style/rule across projects -> `user`

### Types

- `fact`: stable concrete info
- `observation`: pattern noticed from recent work
- `preference`: how user wants things done
- `task`: ongoing objective or follow-up commitment

### Required Habit After Successful Work

After each successful, non-trivial turn, add one very concise `project` memory capturing:

- what was done
- how it was done
- why that approach was used

Keep this to 1-2 short sentences total.

If, during the same turn, you identify something broadly reusable across projects (preference, style, recurring rule, communication preference), also add a separate `user` memory.

### What To Store

Store only information that is likely to matter later:

- decisions, constraints, conventions, trade-offs
- user preferences that affect future behavior
- durable troubleshooting findings and known pitfalls
- active tasks/goals that may continue in later sessions

Do not store:

- transient one-off chatter
- data obvious from current files unless the decision/rationale matters
- duplicate entries with no new value

### How To Write `content`

Write retrieval-friendly content:

- concise and specific
- include key nouns (feature/module/file/tool)
- include outcome + rationale
- avoid fluff

Good pattern:

- `<Outcome>. <Method>. <Reason/constraint>.`

### `metadata` Usage

Use `metadata` as optional structured context (dictionary), for example:

- `files`: touched paths
- `decision`: short decision tag
- `reason`: main rationale
- `scope_hint`: optional discriminator
- `title`: short label (helps embeddings)

Prefer small, meaningful keys and values.

### When To Search

Use `memory_search` when prior context may matter:

- user says "continue", "as before", "same style", "like last time"
- implementation likely depends on earlier decisions
- personalization may affect response style or technical choices

Avoid broad fishing queries. Use targeted query strings and optional `types` filters.

### Examples

Project memory after successful turn:

- `memory_add`
  - `scope`: `project`
  - `type`: `fact`
  - `content`: `Created a consistent scope strategy so project-specific context stays separated from broader user context. Updated the workflow guide to match the new memory commands and argument order. Chosen to improve retrieval precision and reduce accidental cross-context mixing.`
  - `metadata`: `{ "title": "scope strategy update", "decision": "context-isolation" }`

User preference memory:

- `memory_add`
  - `scope`: `user`
  - `type`: `preference`
  - `content`: `User prefers concise updates and practical, low-overhead solutions unless extra detail is requested.`
  - `metadata`: `{ "title": "communication preference", "style": "concise" }`

Targeted search:

- `memory_search`
  - `scope`: `project`
  - `query`: `scope strategy archive behavior usage guidance`
  - `types`: `[ "fact", "observation" ]`
  - `k`: `5`

Archive obsolete memory:

- `memory_archive`
  - `scope`: `project`
  - `id`: `<memory-id>`
  - `reason`: `Superseded by newer guidance and no longer reflects current behavior`

### Conflict Handling

- Current user message and current session context override memory.
- If memory conflicts with fresh instructions, follow fresh instructions.
- Archive stale/incorrect memory once confirmed.
