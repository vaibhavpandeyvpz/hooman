---
title: CLI
description: hooman chat, setup, exec, daemon, config, session modes, and flags — the terminal surface of the full-stack agent.
---

![Hooman CLI chat session](/hooman/screenshots/ask-mode.png)

Hooman ships as a single `hooman` binary with five surfaces on the same agent core: first-run `setup`, interactive `chat`, one-shot `exec`, channel-driven `daemon`, and an [`acp`](/hooman/guides/acp/) agent for editor clients. Local-first, BYOK, and MIT licensed — the same runtime as VS Code and Design mode.

## `hooman setup`

Create `~/.hooman/config.json` with a guided wizard (inference provider + search). Credentials are validated before write: the provider is checked by listing models, and search with a one-result probe (DuckDuckGo needs no key). The wizard writes all available chat LLMs for the chosen provider (preferred model first as `default`).

```bash
hooman setup
```

Running `hooman` with no arguments also opens setup when `config.json` is missing, then starts chat. Re-run `hooman setup` anytime to recreate home config (it overwrites `~/.hooman/config.json`). For day-to-day edits without rewriting the file from scratch, use [`hooman config`](#hooman-config) or chat `/config`.

## `hooman chat`

Start an interactive stateful chat session.

```bash
hooman
# if ~/.hooman/config.json exists — equivalent to:
hooman chat
```

Optional initial prompt:

```bash
hooman chat "Help me prioritize the next task"
```

Shared agent flags (also on `exec` and `daemon`):

```bash
hooman chat --session my-session
hooman chat --continue          # or -C — resume latest project session
hooman chat --mode ask          # or -m
hooman chat --model "Gemma 4 E2B (Q4_K_M)"
hooman chat --effort medium     # off | minimal | low | medium | high
hooman chat --yolo              # auto-approve tool calls
```

The status bar under the composer has three rows:

- model / effort / mode / yolo
- a usage row — `context: N% (used/size)`, the latest request's `tokens` (`in`/`cin`/`out`), and cumulative session `cost: $…` — each segment only appears once it has data (context and cost require resolvable [LLM metadata](/hooman/guides/configuration/models/#llm-metadata))
- an mcp/tools/skills row, with a live `elapsed` timer while a turn runs

### Chat commands

Type `/` inside a chat session to discover slash commands:

| Command     | Purpose                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------- |
| `/model`    | Pick or set the chat model for this session.                                                   |
| `/effort`   | Pick or set reasoning effort (`off`, `minimal`, `low`, `medium`, `high`); Shift+Tab cycles it. |
| `/mode`     | Switch session mode (`agent`, `ask`, `plan`, `design`); see [Modes](/hooman/guides/modes/).    |
| `/yolo`     | Toggle auto-approve of tool calls (`on` / `off`).                                              |
| `/init`     | Generate or refresh `AGENTS.md` for the current project.                                       |
| `/compact`  | Compact the conversation history now and persist the result.                                   |
| `/new`      | Start a fresh chat session.                                                                    |
| `/sessions` | Browse and resume saved sessions.                                                              |
| `/tasks`    | List active [background shell jobs](/hooman/guides/tools/#shell) and stop one.                 |
| `/config`   | Launch the [configuration workflow](#hooman-config).                                           |

While background jobs are running, the composer chrome also shows a compact count (`N background jobs · /tasks to stop`).

## `hooman exec`

Run a single prompt once, without an interactive session. Accepts the same shared flags as `chat` (`--session`, `--continue`, `--mode`, `--effort`, `--model`, `--yolo`).

```bash
hooman exec "Summarize the current repository"
hooman exec "What changed?" --session my-session
hooman exec "Map the architecture" --mode ask --effort low
hooman exec "Summarize this repo" --yolo
```

## `hooman daemon`

Run a long-lived daemon that **always** subscribes to MCP servers advertising the `hooman/channel` capability and feeds each received notification into the agent as a queued prompt. See [MCP Channels](/hooman/guides/mcp/channels/) for the full automation model. Accepts the same shared flags as `chat`, plus `--debug` for raw notification payloads.

```bash
hooman daemon
hooman daemon --session my-daemon
hooman daemon --continue
hooman daemon --mode agent --model "Claude Sonnet" --effort medium
hooman daemon --yolo
hooman daemon --debug
```

## Session mode

`exec`, `chat`, and `daemon` accept **`-m` / `--mode`**. Full details for each mode:

- [Agent](/hooman/guides/modes/agent/) (default) — full tool surface including shell
- [Plan](/hooman/guides/modes/plan/) — plan document + checklist; leave only with approval
- [Ask](/hooman/guides/modes/ask/) — read-oriented Q&A and exploration
- [Design](/hooman/guides/modes/design/) — HTML artifacts, preview, and export to PDF / PowerPoint-ready `.pptx` / Figma-ready `.fig` / `.deck` / Sketch-ready `.sketch`

See the [Modes overview](/hooman/guides/modes/). In `chat`, `/mode` switches between them. ACP and the VS Code extension expose the same values; **Yolo** is a separate boolean (CLI `/yolo` / `--yolo`, ACP `yolo`) and is not a mode.

`--model` selects a named entry from `config.json` `llms` (and persists it as the default when that entry exists in the home config). `--effort` sets reasoning effort on the active provider (`off`, `minimal`, `low`, `medium`, `high`), matching chat `/effort`.

## `hooman sessions`

List and inspect saved CLI sessions for the current project.

```bash
hooman sessions list
```

## `hooman config`

Open the interactive configuration UI (same workflow as chat `/config`). Pass **`-d` / `--debug`** to dump the merged runtime `config.json` for the current working directory instead (credential-like values redacted).

```bash
hooman config
hooman config --debug
```

It currently lets you:

- manage general settings such as name, prompts, tools, compaction, and global reasoning display
- manage models and providers with field-by-field editors, including per-LLM metadata overrides
- choose a search provider and set its API key (DuckDuckGo needs no key)
- toggle bundled harness prompts (`behaviour`, `communication`, `execution`, `guardrails`)
- edit `instructions.md` in your `$VISUAL` / `$EDITOR` (cross-platform fallback included)
- add, edit, and delete MCP servers with field-by-field editors and confirmation
- search, install, refresh, and remove [skills](/hooman/guides/skills/)

From inside a `chat` session, `/config` launches the same UI on the alternate screen buffer and restores the chat on exit (re-bootstrapping so config changes apply).

### Feature flags

Runtime tool and prompt switches, controlled from `config.json` (see [Configuration](/hooman/guides/configuration/)):

- `search.enabled`, `search.provider` (`brave`, `duckduckgo`, `exa`, `firecrawl`, `litellm`, `serper`, or `tavily`), plus per-provider options — see [Search](/hooman/guides/configuration/search/)
- `prompts.behaviour`, `prompts.communication`, `prompts.execution`, `prompts.guardrails` — see [Prompts](/hooman/guides/configuration/prompts/)
- `tools.todo.enabled`, `tools.fetch.enabled`, `tools.filesystem.enabled`, `tools.shell.enabled`, `tools.sleep.enabled`, `tools.browser.enabled`, `tools.subagents.enabled` — see [Tools](/hooman/guides/configuration/tools/)

## MCP auth commands

Remote MCP OAuth helpers, independent of `hooman config`:

```bash
hooman mcp auth <server>                # OAuth login for a configured MCP server
hooman mcp logout <server>              # Clear stored OAuth credentials
hooman mcp logout <server> --scope all  # Scope: all, client, tokens, discovery
hooman mcp status                       # Show MCP server auth status
```

See [MCP OAuth](/hooman/guides/mcp/#oauth) for the full flow.
