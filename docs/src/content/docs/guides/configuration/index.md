---
title: Configuration
description: The ~/.hooman layout and config.json shape, with a guide to every configuration area.
---

Hooman stores its data under `~/.hooman/` (or `$HOOMAN_HOME` when set). The main file is `config.json`: a single top-level `name`, plus one section per configuration area, each covered in its own page below.

## `name`

A non-empty display name for the agent. It's the only required scalar field — everything else has a default.

```json
{
  "name": "Hooman"
}
```

## Minimal example

A minimal valid `config.json` needs `name`, `providers`, and a non-empty `llms` array; every other section (`search`, `prompts`, `tools`, `compaction`, `reasoning`) is optional and filled in with defaults on load:

```json
{
  "name": "Hooman",
  "providers": [
    {
      "name": "llama.cpp",
      "provider": "llama-cpp",
      "options": {}
    }
  ],
  "llms": [
    {
      "name": "Gemma 4 E2B (llama.cpp)",
      "provider": "llama.cpp",
      "options": {
        "model": "unsloth/gemma-4-E2B-it-GGUF:Q4_K_M"
      },
      "default": false
    },
    {
      "name": "Qwen3.5 2B (llama.cpp)",
      "provider": "llama.cpp",
      "options": {
        "model": "unsloth/Qwen3.5-2B-MTP-GGUF:Q4_K_M"
      },
      "default": false
    }
  ]
}
```

## Configuration reference

| Section                                                | Covers                                                                                                          |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| [Models](/hooman/guides/configuration/models/)         | `providers` / `llms` — credentials, model options, reasoning, and metadata overrides for cost/context tracking. |
| [Search](/hooman/guides/configuration/search/)         | `search` — enabling `web_search` and picking/configuring a provider.                                            |
| [Prompts](/hooman/guides/configuration/prompts/)       | `prompts` — toggling bundled harness prompt sections.                                                           |
| [Tools](/hooman/guides/configuration/tools/)           | `tools` — enabling/disabling built-in tools.                                                                    |
| [Compaction](/hooman/guides/configuration/compaction/) | `compaction` — context-compaction tuning.                                                                       |
| [`reasoning`](#global-reasoning-display)               | global reasoning display in the CLI/chat UI (`collapsed` or `full`).                                            |
| [Instructions](#instructions)                          | `instructions.md` — free-form custom instructions, outside `config.json`.                                       |

Tool approvals are session-scoped and are **not** persisted in `config.json` — see [Tools](/hooman/guides/tools/#approvals).

## `~/.hooman` layout

| Path               | Purpose                                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `config.json`      | App name, reusable provider configs, model configs, search/prompt/tool flags, compaction, and global reasoning display. |
| `instructions.md`  | System instructions used to build the agent prompt.                                                                     |
| `mcp.json`         | MCP server definitions.                                                                                                 |
| `mcp-oauth.json`   | Stored OAuth credentials for remote MCP servers.                                                                        |
| `skills/`          | Installed [skills](/hooman/guides/skills/).                                                                             |
| `bin/`             | Runtime-managed helper binaries (including bootstrapped `rg` for the `grep` tool when system `rg` is unavailable).      |
| `cache/`           | Runtime caches used by tools and subsystems.                                                                            |
| `projects.json`    | Registry mapping each project root to a stable UUID.                                                                    |
| `projects/<uuid>/` | Per-project storage, scoped to the project (git root, falling back to cwd) the session runs in.                         |

Inside each `projects/<uuid>/` directory:

- `sessions/` — persisted session data (per-session snapshots and the ACP session index at `sessions/acp/sessions.jsonl`)
- `offloaded-content/` — offloaded tool output (large tool results retrievable via `retrieve_offloaded_content`)
- `memory/` — durable extracted memory store
- `attachments/` — saved attachments (e.g. clipboard images)
- `plans/` — plan-mode markdown documents

`sessions`, `memory`, `attachments`, and `plans` are scoped per project rather than shared globally. On first use in a working directory, Hooman resolves the project root (the nearest git root, falling back to the cwd), mints a UUID for it, and records the mapping in `~/.hooman/projects.json`. Config and MCP resolution are unaffected by this — see the overlays below.

Hooman enables the Strands `ContextOffloader` by default with file-backed storage under the project-scoped `~/.hooman/projects/<uuid>/offloaded-content`, so large tool results can be previewed in-context and retrieved later without bloating the active conversation window.

## Global reasoning display

Top-level `reasoning` controls how model thinking is displayed in the chat UI when a provider returns reasoning content.

| Value       | Default     | Meaning                                                |
| ----------- | ----------- | ------------------------------------------------------ |
| `collapsed` | `collapsed` | Show reasoning in a collapsed/summary form by default. |
| `full`      |             | Show the full reasoning stream inline when available.  |

Example:

```json
{
  "reasoning": "full"
}
```

This is separate from provider-level `options.reasoning` on model providers:

- top-level `reasoning` controls **display in the UI**
- provider-level `options.reasoning` controls **whether/how the model thinks**

## Instructions

`~/.hooman/instructions.md` (or `$HOOMAN_HOME/instructions.md`) holds free-form custom instructions, separate from `config.json`. It doesn't exist by default — create it only if you want to add always-on guidance beyond the bundled harness prompts.

### Setting it up

- Create/edit the file directly at `~/.hooman/instructions.md` with any editor.
- Or, from inside a `chat` session, run `/config` and choose the instructions editor: it opens the file in your `$VISUAL`/`$EDITOR` (with a cross-platform fallback when neither is set) and reloads the session on exit.

There's no schema — it's plain Markdown/text, appended verbatim (after light Handlebars rendering, see below).

### How it's used

`instructions.md` is rendered into every system prompt, right after the bundled harness prompt sections ([`prompts.behaviour`/`communication`/`execution`/`guardrails`](/hooman/guides/configuration/prompts/)) and before any `AGENTS.md` content:

1. Bundled static tool prompts (varies with enabled tools)
2. Bundled harness prompts (whichever `prompts.*` sections are enabled)
3. `instructions.md`, if present
4. `AGENTS.md` content, discovered from the git root down to the current directory

Each section is separated by a `---` break. Because the whole template (including your `instructions.md` content) is compiled with Handlebars, you can reference the same variables the built-in prompts use — `{{name}}`, `{{llm.model}}`, `{{environment.datetime}}`, `{{compaction.ratio}}` — and they're substituted with live values from the current session.

`instructions.md` is a single home-level file: unlike `config.json`/`mcp.json`, it has **no** project-local `.hooman/` overlay. For project-specific guidance that should only apply inside a given repo, use an `AGENTS.md` file at the relevant directory instead — see [repo-local overlays](#repo-local-runtime-overlays) below for how the two mechanisms differ.

Any change to `instructions.md` requires restarting the running agent/session before it takes effect; `/config` does this automatically when you exit the editor.

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

## Ripgrep bootstrap

The built-in `grep` tool resolves its binary in this order:

1. Use system `rg` when available.
2. Else use cached `~/.hooman/bin/rg` (or `rg.exe` on Windows).
3. Else download and checksum-verify a platform-specific ripgrep release into `~/.hooman/bin/`.

First use on a system without `rg` may require network access.
