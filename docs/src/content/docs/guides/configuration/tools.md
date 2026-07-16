---
title: Tools
description: Enable or disable built-in tools via the tools block in config.json.
---

The `tools` block toggles built-in runtime tools. Each toggle is optional; omitted fields are filled in with defaults on load. All tool toggles default to `true` except `browser.enabled`, which defaults to `false`.

## Fields

| Field                | Default | Tool(s) disabled when `false`                                                                                                                                                                                                                                 |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `todo.enabled`       | `true`  | `todo` — the task list tool.                                                                                                                                                                                                                                  |
| `fetch.enabled`      | `true`  | `fetch` — fetching URL content (and optionally saving it to disk via `save_as`).                                                                                                                                                                              |
| `filesystem.enabled` | `true`  | Filesystem tools (`read_file`, `read_multiple_files`, `edit_file`, `edit_multiple_files`, etc.) **and** `grep`, which is bundled under this same toggle.                                                                                                      |
| `shell.enabled`      | `true`  | `shell`, `shell_output`, and `shell_stop` — foreground commands plus [background jobs](/hooman/guides/tools/#shell).                                                                                                                                          |
| `sleep.enabled`      | `true`  | `sleep` — pausing execution for a duration.                                                                                                                                                                                                                   |
| `browser.enabled`    | `false` | Browser automation via an injected default [Playwright MCP](https://github.com/microsoft/playwright-mcp) server (`@playwright/mcp`). There is no separate first-party browser tool API — see [Tools → Browser](/hooman/guides/tools/#browser-playwright-mcp). |
| `subagents.enabled`  | `true`  | `launch_subagent` — built-in read-only subagent launcher (`kind`: `research`, `code-review`, `quality-analyst`, `design-review`).                                                                                                                             |

`think`, `ask_user`, `get_current_time`/`convert_time`, and `switch_mode` are always registered and have no config toggle. Design-mode tools (`preview_design`, `stop_design_preview`, `export_design`) are mode-gated — they appear only in [design mode](/hooman/guides/modes/design/), not via a `tools.*` toggle. `web_search` is controlled separately by [`search.enabled`](/hooman/guides/configuration/search/), not by this block. MCP-provided tools and installed skills aren't affected by `tools` either — see [MCP](/hooman/guides/mcp/) and [Skills](/hooman/guides/skills/).

For what each tool does and its arguments, plus the tool-approval flow (which is independent of these enable/disable toggles and not persisted in `config.json`), see [Tools](/hooman/guides/tools/).

## Example configs

Defaults (all tools on — equivalent to omitting `tools` entirely):

```json
{
  "tools": {
    "todo": { "enabled": true },
    "fetch": { "enabled": true },
    "filesystem": { "enabled": true },
    "shell": { "enabled": true },
    "sleep": { "enabled": true },
    "browser": { "enabled": false },
    "subagents": { "enabled": true }
  }
}
```

Read-only setup — no shell, no filesystem writes, no subagents (only toggles the ones you want off; the rest keep their defaults):

```json
{
  "tools": {
    "shell": { "enabled": false },
    "filesystem": { "enabled": false },
    "subagents": { "enabled": false }
  }
}
```
