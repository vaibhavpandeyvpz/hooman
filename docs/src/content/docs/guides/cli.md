---
title: CLI
description: hooman chat, exec, daemon, config, session modes, and flags.
---

Hooman ships as a single `hooman` binary with four surfaces built on the same agent core: an interactive `chat`, a one-shot `exec`, a channel-driven `daemon`, and an [`acp`](/hooman/guides/acp/) agent for editor clients.

## `hooman chat`

Start an interactive stateful chat session.

```bash
hooman
# equivalent to:
hooman chat
```

Optional initial prompt:

```bash
hooman chat "Help me prioritize the next task"
```

Resume or pin a session id:

```bash
hooman chat --session my-session
```

Skip the in-chat tool approval UI (auto-approve every tool call; use only when you trust the prompt and environment):

```bash
hooman chat --yolo
```

Start in [ask mode](#session-mode):

```bash
hooman chat --mode ask
```

The status bar under the composer has three rows:

- model / effort / mode / yolo
- a usage row — `context: N% (used/size)`, the latest request's `tokens` (`in`/`cin`/`out`), and cumulative session `cost: $…` — each segment only appears once it has data (context and cost require resolvable [billing metadata](/hooman/guides/configuration/models/#billing-metadata))
- an mcp/tools/skills row, with a live `elapsed` timer while a turn runs

### Chat commands

Type `/` inside a chat session to discover slash commands:

| Command     | Purpose                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------- |
| `/model`    | Pick or set the chat model for this session.                                                   |
| `/effort`   | Pick or set reasoning effort (`off`, `minimal`, `low`, `medium`, `high`); Shift+Tab cycles it. |
| `/mode`     | Switch session mode (`agent`, `ask`, `plan`); see [Session mode](#session-mode).               |
| `/yolo`     | Toggle auto-approve of tool calls (`on` / `off`).                                              |
| `/init`     | Generate or refresh `AGENTS.md` for the current project.                                       |
| `/compact`  | Compact the conversation history now and persist the result.                                   |
| `/new`      | Start a fresh chat session.                                                                    |
| `/sessions` | Browse and resume saved sessions.                                                              |
| `/config`   | Launch the [configuration workflow](#config).                                                  |

## `hooman exec`

Run a single prompt once, without an interactive session.

```bash
hooman exec "Summarize the current repository"
```

Use a specific session id:

```bash
hooman exec "What changed?" --session my-session
```

Skip interactive tool approval:

```bash
hooman exec "Summarize this repo" --yolo
```

Start in ask mode (narrower tool surface, no plan lifecycle tools):

```bash
hooman exec "Map the architecture" --mode ask
```

## `hooman daemon`

Run a long-lived daemon that **always** subscribes to MCP servers advertising the `hooman/channel` capability and feeds each received notification into the agent as a queued prompt. See [MCP Channels](/hooman/guides/mcp/channels/) for the full automation model.

```bash
hooman daemon
```

Resume or pin a session id:

```bash
hooman daemon --session my-daemon
```

Skip remote channel permission relay and allow every tool call from daemon turns (same risk profile as `--yolo` elsewhere):

```bash
hooman daemon --yolo
```

Log raw notification payloads:

```bash
hooman daemon --debug
```

## Session mode

`exec`, `chat`, and `daemon` accept **`-m` / `--mode`** with:

- **`agent`** (default) — normal tool surface and approvals.
- **`plan`** — planning workflow with a reduced tool surface plus `enter_plan_mode` / `exit_plan_mode`.
- **`ask`** — read-oriented, narrower surface (similar to interactive plan mode) but without the plan lifecycle tools.

In `chat`, `/mode` switches between `agent`, `ask`, and `plan`. ACP sessions can set `hooman.sessionMode` to the same three values.

## `hooman config`

Print the effective runtime `config.json` for the current working directory — same shape as `config.json`, with credential-like values redacted.

```bash
hooman config
```

### Feature flags

Runtime tool and prompt switches, controlled from `config.json` (see [Configuration](/hooman/guides/configuration/)):

- `search.enabled`, `search.provider` (`brave`, `exa`, `firecrawl`, `litellm`, `serper`, or `tavily`), plus per-provider options — see [Search](/hooman/guides/configuration/search/)
- `prompts.behaviour`, `prompts.communication`, `prompts.execution`, `prompts.guardrails` — see [Prompts](/hooman/guides/configuration/prompts/)
- `tools.todo.enabled`, `tools.fetch.enabled`, `tools.filesystem.enabled`, `tools.shell.enabled`, `tools.sleep.enabled`, `tools.subagents.enabled` — see [Tools](/hooman/guides/configuration/tools/)

## `/config`

The interactive configuration workflow is launched from inside a `chat` session with the `/config` slash command — there's no separate top-level `configure` command. It takes over the terminal on the alternate screen buffer while open, and restores the chat session on exit. Config changes are picked up when the session re-bootstraps.

```text
/config
```

It currently lets you:

- manage general settings such as name, prompts, tools, and compaction
- manage models and providers with field-by-field editors
- choose a search provider and set its API key
- toggle bundled harness prompts (`behaviour`, `communication`, `execution`, `guardrails`)
- edit `instructions.md` in your `$VISUAL` / `$EDITOR` (cross-platform fallback included)
- add, edit, and delete MCP servers with field-by-field editors and confirmation
- search, install, refresh, and remove [skills](/hooman/guides/skills/)

## MCP auth commands

Remote MCP OAuth helpers, independent of `/config`:

```bash
hooman mcp auth <server>                # OAuth login for a configured MCP server
hooman mcp logout <server>              # Clear stored OAuth credentials
hooman mcp logout <server> --scope all  # Scope: all, client, tokens, discovery
hooman mcp auth-status                  # Show MCP server auth status
```

See [MCP OAuth](/hooman/guides/mcp/#oauth) for the full flow.
