---
title: Ask
description: Read-oriented mode for questions, research, and exploration without a plan document.
---

![Hooman Ask mode in the CLI](/hooman/screenshots/ask-mode.png)

**Ask** mode narrows the tool surface for exploration, research, and answering questions. It is similar to [Plan](/hooman/guides/modes/plan/) in posture (no shell-driven implementation) but does **not** open a plan document on disk.

```bash
hooman chat --mode ask
hooman exec "How does auth middleware work?" --mode ask
```

Or `/mode` → **ask** in chat / VS Code.

## Behavior

- Read-oriented: filesystem reads, grep, fetch, web search, skills, MCP discovery
- Subagents for read-only exploration (`research`, `code-review`, `quality-analyst`)
- No `shell`, `create_directory`, or `move_file`
- `switch_mode` remains available when the answer requires a different posture:
  - **plan** — need a written plan on disk
  - **design** — HTML design artifacts
  - **agent** — implementation or unrestricted edits

Use Ask when you want answers and investigation without kicking off a full planning or coding loop.

## Related

- [Modes overview](/hooman/guides/modes/)
- [Plan mode](/hooman/guides/modes/plan/)
- [Agent mode](/hooman/guides/modes/agent/)
