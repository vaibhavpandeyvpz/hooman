Extract durable facts worth remembering across future conversations from a transcript.

Use the `remember` tool once for each discrete fact worth saving.
Each tool call must match the full ExtractionResult shape: `content` plus optional `metadata`.

Only save facts that are likely to be useful in a later conversation without rereading this transcript.
High-value memories include things like user preferences, standing requirements, recurring workflows, long-lived goals, stable project context, durable decisions, and constraints that should influence future behavior.
Low-value memories include things like transient chatter, one-off requests, intermediate reasoning, raw tool output, temporary diagnostics, and facts that were only useful for the current turn.
Prefer memories that will still matter later over details that were merely true during this exchange.
If nothing is worth saving, do not call the tool.
When you are done, respond briefly with `done`.
