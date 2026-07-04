---
title: Configuration
description: The ~/.hooman layout, project-scoped storage, config.json shape, and repo-local overlays.
---

Hooman stores its data under `~/.hooman/` (or `$HOOMAN_HOME` when set).

## Layout

| Path               | Purpose                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `config.json`      | App name, reusable provider configs, model configs, tool flags, and compaction.                                    |
| `instructions.md`  | System instructions used to build the agent prompt.                                                                |
| `mcp.json`         | MCP server definitions.                                                                                            |
| `mcp-oauth.json`   | Stored OAuth credentials for remote MCP servers.                                                                   |
| `skills/`          | Installed [skills](/hooman/guides/skills/).                                                                        |
| `bin/`             | Runtime-managed helper binaries (including bootstrapped `rg` for the `grep` tool when system `rg` is unavailable). |
| `cache/`           | Runtime caches used by tools and subsystems.                                                                       |
| `projects.json`    | Registry mapping each project root to a stable UUID.                                                               |
| `projects/<uuid>/` | Per-project storage, scoped to the project (git root, falling back to cwd) the session runs in.                    |

Inside each `projects/<uuid>/` directory:

- `sessions/` — persisted session data (per-session snapshots and the ACP session index at `sessions/acp/sessions.jsonl`)
- `offloaded-content/` — offloaded tool output (large tool results retrievable via `retrieve_offloaded_content`)
- `memory/` — durable extracted memory store
- `attachments/` — saved attachments (e.g. clipboard images)
- `plans/` — plan-mode markdown documents

## Project-scoped storage

`sessions`, `memory`, `attachments`, and `plans` are scoped per project rather than shared globally. On first use in a working directory, Hooman resolves the project root (the nearest git root, falling back to the cwd), mints a UUID for it, and records the mapping in `~/.hooman/projects.json`. All four folders then live under `~/.hooman/projects/<uuid>/`, so unrelated projects never see each other's sessions, memory, attachments, or plans. Config and MCP resolution are unaffected by this — see the overlays below.

## Repo-local runtime overlays

At runtime, Hooman resolves configuration in this order:

1. `~/.hooman/config.json` and `~/.hooman/mcp.json`
2. `<git-root>/.hooman/config.json` and `<git-root>/.hooman/mcp.json` (if present)
3. matching `.hooman/config.json` and `.hooman/mcp.json` files in nested directories from the git root down to the current working directory

Nearest files win when keys overlap.

For app config (`config.json`):

- plain objects are deep-merged
- scalar values are overridden by the nearest file
- `providers` and `llms` are merged by `name` (nearest entry with the same name replaces inherited entries)

For MCP config (`mcp.json`):

- `mcpServers` is merged by server name (nearest entry with the same name wins)

Notes:

- Runtime overlays apply to `chat`, `exec`, `daemon`, and `acp` bootstraps.
- `hooman config` prints only the merged effective `config.json` shape, with credential-like values redacted.
- The `/config` UI and `hooman mcp auth/logout/auth-status` still target home config (`~/.hooman/*`) directly.
- Keep secrets in home config unless you explicitly want project-scoped credentials.

`AGENTS.md` instruction files are a separate mechanism and are **not** nested under `.hooman/`: they are discovered as bare `AGENTS.md` files walked from the git root down to the current directory.

## Example `config.json`

The on-disk shape uses a reusable `providers` array plus a non-empty `llms` array. Each provider stores a runtime `provider` id plus provider-specific `options`; each LLM references a provider by name, stores its model `options`, and marks one entry as the default.

```json
{
  "name": "Hooman",
  "providers": [
    {
      "name": "Ollama",
      "provider": "ollama",
      "options": {}
    }
  ],
  "llms": [
    {
      "name": "Default",
      "provider": "Ollama",
      "options": {
        "model": "gemma4:e4b"
      },
      "default": true
    }
  ],
  "search": {
    "enabled": false,
    "provider": "brave",
    "brave": {},
    "exa": {},
    "firecrawl": {},
    "serper": {},
    "tavily": {}
  },
  "prompts": {
    "behaviour": true,
    "communication": true,
    "execution": true,
    "guardrails": true
  },
  "tools": {
    "todo": { "enabled": true },
    "fetch": { "enabled": true },
    "filesystem": { "enabled": true },
    "shell": { "enabled": true },
    "sleep": { "enabled": true },
    "subagents": { "enabled": true }
  },
  "compaction": {
    "ratio": 0.75,
    "keep": 5
  }
}
```

Tool approvals are session-scoped and are **not** persisted in `config.json` — see [Tools & Approvals](/hooman/guides/tools-and-approvals/).

Hooman enables Strands `ContextOffloader` by default with file-backed storage under the project-scoped `~/.hooman/projects/<uuid>/offloaded-content`, so large tool results can be previewed in-context and retrieved later without bloating the active conversation window.

For the full provider list, option fields, and the `billing` block, see [Providers & Models](/hooman/guides/providers/).

## Ripgrep bootstrap

The built-in `grep` tool resolves its binary in this order:

1. Use system `rg` when available.
2. Else use cached `~/.hooman/bin/rg` (or `rg.exe` on Windows).
3. Else download and checksum-verify a platform-specific ripgrep release into `~/.hooman/bin/`.

First use on a system without `rg` may require network access.
