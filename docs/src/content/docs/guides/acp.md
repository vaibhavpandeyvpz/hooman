---
title: ACP
description: Running Hooman as an Agent Client Protocol agent — sessions, usage_update, and client integration.
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
- Session configuration includes `hooman.sessionMode` (`agent`, `plan`, or `ask`) — see [Session mode](/hooman/guides/cli/#session-mode).

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

## Building an ACP client

Any ACP-compatible editor can drive Hooman by spawning `hooman acp` and speaking the protocol over stdio. The [VS Code extension](/hooman/guides/vscode/) is the reference client implementation in this repository — see its `acp-client.ts`, `fs-backend.ts`, and `terminal-backend.ts` for how the client-side `fs/*` and `terminal/*` capabilities are implemented against an editor's workspace APIs.
