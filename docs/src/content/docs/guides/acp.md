---
title: ACP
description: Running Hooman as an Agent Client Protocol agent — sessions, config options, usage_update, and client integration.
---

Run Hooman as an [Agent Client Protocol](https://agentclientprotocol.com) (ACP) agent over stdio, for editors like Zed and the [Hooman VS Code extension](/hooman/guides/vscode/):

```bash
hooman acp
```

## Session semantics

- ACP session metadata is indexed in the active project's `sessions/acp/sessions.jsonl` — an append-only JSONL patch log (last record wins per session id, deletes are tombstones) holding only protocol-facing metadata: `cwd`, title, client user id, session-scoped MCP servers, vscode flag, yolo/mode/model.
- Conversation history is **not** duplicated there: the Strands `SessionManager` snapshot (`sessions/<session-id>/snapshot_latest.json`) is the single source of truth for messages, restored during `agent.initialize()` on `session/load`/`resume` and saved on every turn.
- ACP loads MCP servers passed on `session/new` and `session/load`, in addition to Hooman's local `mcp.json` — unless the client identifies as the official VS Code extension via `_meta["hoomanjs/vscode"]: true`, in which case the local MCP config (home + repo overlays) loads as usual on top of any session-scoped servers.
- `session/new` and `session/load` support `_meta.userId`.
- Session mode is advertised as a session config option (`mode`: `agent`, `plan`, or `ask`) — see [Session mode](/hooman/guides/cli/#session-mode). Yolo is a separate boolean option, not a mode value.

## Session config options

Hooman advertises ACP [session config options](https://agentclientprotocol.com/protocol/v1/session-config-options) so clients can render pickers without hardcoding Hooman-specific UI:

| Id       | Name             | Category       | Type      | Purpose                                                             |
| -------- | ---------------- | -------------- | --------- | ------------------------------------------------------------------- |
| `model`  | Model            | `model`        | `select`  | Active named LLM from `config.json`.                                |
| `effort` | Reasoning Effort | `model_config` | `select`  | `off` / `minimal` / `low` / `medium` / `high` for the active model. |
| `mode`   | Session Mode     | `mode`         | `select`  | `agent` / `plan` / `ask` — tool surface and permission behaviour.   |
| `yolo`   | Yolo             | `model_config` | `boolean` | Auto-approve tool calls without prompting (default `false`).        |

`effort` and `yolo` use the `model_config` category so clients group them with secondary model controls alongside the primary Model selector, not as peers of Session Mode. Clients should keep any legacy `modes` field in sync with `mode` during the protocol transition.

## Cancellation

When the client cancels a turn (`session/cancel` / stop):

- Pending `session/request_permission` prompts are resolved as cancelled so the agent does not wait on a dismissed approval.
- In-flight tool work is interrupted according to the ACP cancellation model; the [VS Code extension](/hooman/guides/vscode/) also marks unfinished tool cards as cancelled in the UI (ACP itself has no separate cancelled tool status).

## Session titles

Session list titles are AI-generated from the first user prompt by a Strands plugin registered on every agent, falling back to the first prompt line on failure. ACP sets an echo-derived placeholder title on the first prompt; once the generated title lands it patches the ACP session index and pushes a `session_info_update` to the client.

## Usage updates

Each turn ends with a `usage_update` carrying:

- `used` / `size` — context-window utilization (`size` is `0` when the model's metadata can't be resolved)
- `cost` — cumulative session cost (omitted when unresolved)
- the latest request's token totals under `_meta["hoomanjs/tokens"]`

`size` and `cost` come from the model's [LLM metadata](/hooman/guides/configuration/models/#llm-metadata) (models.dev-backed). A model switch pushes a fresh `usage_update` immediately so clients can rescale right away.

## Ask-user questions

The built-in `ask_user` tool is presented as a `session/request_permission` request whose options are the answer choices plus Dismiss, tagged `_meta["hoomanjs/ask_user"]` so clients like the VS Code extension can render a question-styled card instead of the generic shield permission card. See [Tools](/hooman/guides/tools/#across-surfaces).

## Custom methods

Hooman also exposes a small set of `_hoomanjs/*` extensions used by the VS Code client (and available to other clients that opt in):

| Method                     | Purpose                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `_hoomanjs/rewind_session` | Cursor-style revert: splice agent history back to a prior user turn's in-memory checkpoint (`messageId`). |
| `_hoomanjs/model_download` | Notification stream for local llama.cpp weight downloads (progress for the download strip in VS Code).    |
| `_hoomanjs/stop_shell_job` | Stop a [background shell job](/hooman/guides/tools/#shell) by `jobId` (used by the VS Code Stop control). |

Background shell job lifecycle updates are also pushed on tool/`session/update` traffic under `_meta["hoomanjs/shell_job"]` so clients can render an active-jobs strip without polling.

Rewind only works for turns that still have an in-memory checkpoint (not for replayed history). The VS Code extension pairs it with restoring workspace file edits from that turn onward — see [VS Code](/hooman/guides/vscode/).

## Building an ACP client

Any ACP-compatible editor can drive Hooman by spawning `hooman acp` and speaking the protocol over stdio. The [VS Code extension](/hooman/guides/vscode/) is the reference client implementation in this repository — see its `acp-client.ts`, `fs-backend.ts`, and `terminal-backend.ts` for how the client-side `fs/*` and `terminal/*` capabilities are implemented against an editor's workspace APIs.
