---
title: Tools & Approvals
description: Built-in tools, the ask_user flow, subagents, and the tool approval model.
---

## Built-in tools

- **`grep`** — backed by ripgrep (`rg`), with runtime bootstrap (download + checksum-verify into `~/.hooman/bin/`) when `rg` isn't already on `PATH`. See [ripgrep bootstrap](/hooman/guides/configuration/#ripgrep-bootstrap).
- **`filesystem`**, **`shell`**, **`fetch`**, **`sleep`**, **`todo`** — toggleable via `tools.*.enabled` in `config.json`. See [feature flags](/hooman/guides/cli/#feature-flags).
- **`web_search`** — optional, provider-selectable (`brave`, `exa`, `firecrawl`, `serper`, `tavily`) via `search.*` config.
- **Subagents** — `subagent_research`, `subagent_review`, `subagent_test_investigator`: built-in read-only subagent tools, toggled by `tools.subagents.enabled`.
- **`ask_user`** — always registered (no config toggle). Lets the agent ask a multiple-choice question mid-task and wait for the answer.

### `ask_user` across surfaces

`ask_user` is approval-exempt — the question itself is the interaction, so it never goes through the tool-approval flow below.

| Surface | Presentation |
| --- | --- |
| `chat` | Inline picker in the composer chrome, with free-text answer and dismiss. |
| `exec` | Numbered readline prompt when a TTY is present. |
| ACP clients (Zed, the VS Code extension) | A question-styled permission card whose options are the answer choices plus Dismiss. |
| `daemon`, non-TTY `exec`, subagents | No user available — the tool returns `no_user_available` and the agent proceeds on its own judgement. |

Dismissals return `dismissed` rather than an error.

## Tool approvals

By default, Hooman asks for approval before running destructive tools (`shell`, `filesystem` writes, etc.):

- `chat` renders an inline approval prompt.
- `exec` prompts on the TTY (when present).
- `daemon` relays the approval request back to the originating MCP server if it supports `hooman/channel/permission`; otherwise the tool call is denied.
- ACP clients receive a `session/request_permission` request, rendered as a permission card by clients like the VS Code extension.

`--yolo` on `exec`, `chat`, or `daemon` bypasses these approval paths and auto-approves every tool call — use only in trusted environments and with prompts you trust. Tool approvals are session-scoped and are **not** persisted in `config.json`.

## Context offloading

Hooman enables the Strands `ContextOffloader` by default, backed by file storage under the project-scoped `~/.hooman/projects/<uuid>/offloaded-content`. Large tool results are previewed in-context and can be retrieved later via `retrieve_offloaded_content` without bloating the active conversation window.
