---
title: Plan
description: Planning mode — write a structured plan on disk, then get approval before implementing.
---

![Hooman Plan mode with plan editor and Build](/hooman/screenshots/plan-mode.png)

**Plan** mode is for scoping larger work before implementation. Hooman explores and drafts a Markdown plan document; it does **not** implement until you approve leaving plan (typically to [Agent](/hooman/guides/modes/agent/)).

```bash
hooman chat --mode plan
```

Or `/mode` → **plan** in chat / VS Code.

## Behavior

- Creates (or reopens) a plan file under `~/.hooman/projects/<uuid>/plans/`
- Updates that plan every turn — structured frontmatter with `name`, `overview`, and `tasks`
- `tasks` are an **implementation checklist** for later execution (not a log of planning activity)
- No `shell`, `create_directory`, or `move_file`
- Filesystem writes are scoped to the plan document; subagents stay read-only (`research`, `code-review`, `quality-analyst`)
- Leaving plan via `switch_mode` is a **proposal** — you approve (start implementing) or decline (keep planning)

## Plan file shape

```yaml
---
name: Short title
overview: One-paragraph goal and scope
tasks:
  - content: Add gitignore matcher helper
    status: pending
  - content: Register filesystem guard plugin
    status: pending
---
```

Task `status` is one of `pending`, `in_progress`, or `completed`. Prefer short imperative wording for each task.

In VS Code, `*.plan.md` opens in a dedicated plan editor (checklist + Mermaid in the body), and a plan checklist stays pinned above the transcript.

## Related

- [Modes overview](/hooman/guides/modes/)
- [Agent mode](/hooman/guides/modes/agent/) — where implementation continues after approval
- [`switch_mode`](/hooman/guides/tools/#switch_mode)
