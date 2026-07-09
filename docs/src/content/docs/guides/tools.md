---
title: Tools
description: Every built-in tool Hooman implements — what it does, its arguments — plus how tool approvals surface across chat, exec, daemon, ACP, and MCP channels.
---

This page documents the tools Hooman implements itself (not tools vended by the underlying Strands Agents SDK, such as `skills`, `retrieve_offloaded_content`, `search_memory`, or `strands_structured_output`). Most are toggleable via [`tools.*.enabled`](/hooman/guides/configuration/tools/) in `config.json`.

## Filesystem

Enabled via `tools.filesystem.enabled` (also gates `grep` below).

### Gitignored paths

Filesystem tools refuse paths that match the repository's `.gitignore` (and nested ignore rules). Denied calls return an access-denied error rather than reading or writing the ignored path. Directory listings and trees also skip ignored entries. This guard applies to `read_file`, `read_multiple_files`, `write_file`, `edit_file`, `create_directory`, `list_directory`, `directory_tree`, `move_file`, and `get_file_info`.

`grep` still follows ripgrep's own ignore behaviour; pass `no_ignore: true` when you intentionally need to search ignored files.

### `read_file`

Read a file. Defaults to UTF-8 text with optional line offset/limit. `binary: true` returns images/videos/documents as multimodal content blocks forwarded to the active provider natively where supported (Bedrock for all; Anthropic/Google for images + docs; OpenAI/Ollama for images), or base64 for other binary files.

| Argument | Type    | Required | Description                        |
| -------- | ------- | -------- | ---------------------------------- |
| `path`   | string  | yes      | File path to read.                 |
| `offset` | integer | no       | 1-indexed starting line.           |
| `limit`  | integer | no       | Maximum number of lines to read.   |
| `binary` | boolean | no       | Read as binary/multimodal content. |

### `read_multiple_files`

Read multiple text files in one call. Each file is returned independently with success or error details.

| Argument | Type     | Required | Description                               |
| -------- | -------- | -------- | ----------------------------------------- |
| `paths`  | string[] | yes      | List of file paths to read.               |
| `offset` | integer  | no       | 1-indexed starting line, applied to each. |
| `limit`  | integer  | no       | Maximum lines per file.                   |

### `write_file`

Write text content to a file. Can overwrite or append, and can create parent directories when requested.

| Argument         | Type    | Required | Description                          |
| ---------------- | ------- | -------- | ------------------------------------ |
| `path`           | string  | yes      | File path to write.                  |
| `content`        | string  | yes      | Content to write.                    |
| `append`         | boolean | no       | Append instead of overwrite.         |
| `create_parents` | boolean | no       | Create parent directories if needed. |

### `edit_file`

Apply exact text replacements to a file. Whitespace, indentation, and line endings are tolerated when they don't make the target ambiguous. Fails if a target is missing or matches more than one place.

| Argument  | Type                     | Required | Description                               |
| --------- | ------------------------ | -------- | ----------------------------------------- |
| `path`    | string                   | yes      | File path to edit.                        |
| `edits`   | `{ oldText, newText }[]` | yes      | Exact text replacements applied in order. |
| `dry_run` | boolean                  | no       | Preview edits without writing the file.   |

### `create_directory`

Create a directory, optionally including missing parent directories.

| Argument    | Type    | Required | Description                    |
| ----------- | ------- | -------- | ------------------------------ |
| `path`      | string  | yes      | Directory path to create.      |
| `recursive` | boolean | no       | Create parent directories too. |

### `list_directory`

List files and directories at a path, optionally recursively with depth and exclude patterns.

| Argument           | Type     | Required | Description                  |
| ------------------ | -------- | -------- | ---------------------------- |
| `path`             | string   | yes      | Directory path to list.      |
| `recursive`        | boolean  | no       | List recursively.            |
| `max_depth`        | integer  | no       | Maximum recursion depth.     |
| `exclude_patterns` | string[] | no       | Glob-style exclude patterns. |

### `directory_tree`

Return a recursive JSON tree of a directory, with optional depth and exclude patterns.

| Argument           | Type     | Required | Description                         |
| ------------------ | -------- | -------- | ----------------------------------- |
| `path`             | string   | yes      | Directory path to render as a tree. |
| `max_depth`        | integer  | no       | Maximum recursion depth.            |
| `exclude_patterns` | string[] | no       | Glob-style exclude patterns.        |

### `move_file`

Move or rename a file or directory. Can overwrite the destination if explicitly enabled.

| Argument      | Type    | Required | Description                         |
| ------------- | ------- | -------- | ----------------------------------- |
| `source`      | string  | yes      | Source file or directory.           |
| `destination` | string  | yes      | Destination path.                   |
| `overwrite`   | boolean | no       | Overwrite destination if it exists. |

### `get_file_info`

Get metadata for a file or directory: timestamps, size, type, and permissions.

| Argument | Type   | Required | Description             |
| -------- | ------ | -------- | ----------------------- |
| `path`   | string | yes      | File or directory path. |

## `grep`

Enabled via `tools.filesystem.enabled` (bundled with the filesystem toggle, not a separate one). Backed by ripgrep (`rg`), with runtime bootstrap (download + checksum-verify into `~/.hooman/bin/`) when `rg` isn't already on `PATH`.

| Argument           | Type                                                      | Required | Description                                             |
| ------------------ | --------------------------------------------------------- | -------- | ------------------------------------------------------- |
| `pattern`          | string                                                    | yes      | Regex pattern to search for.                            |
| `path`             | string                                                    | no       | Directory or file path to search from (default `.`).    |
| `output_mode`      | `"paths" \| "content" \| "files_with_matches" \| "count"` | no       | Output mode for search results (default `"paths"`).     |
| `glob`             | string                                                    | no       | Include only files matching this glob (`rg --glob`).    |
| `type`             | string                                                    | no       | Restrict to a ripgrep file type (e.g. `ts`, `py`).      |
| `exclude_patterns` | string[]                                                  | no       | Glob patterns to exclude from results.                  |
| `context`          | integer                                                   | no       | Context lines around matches.                           |
| `before` / `after` | integer                                                   | no       | Lines before / after each match.                        |
| `case_insensitive` | boolean                                                   | no       | Search case-insensitively (`rg -i`).                    |
| `fixed_strings`    | boolean                                                   | no       | Treat pattern as a literal string (`rg -F`).            |
| `multiline`        | boolean                                                   | no       | Enable multiline matching (`rg -U --multiline-dotall`). |
| `no_ignore`        | boolean                                                   | no       | Ignore `.gitignore`/`.ignore` rules during search.      |
| `head_limit`       | integer                                                   | no       | Maximum number of results to return.                    |
| `offset`           | integer                                                   | no       | Skip the first N results before returning output.       |
| `max_results`      | integer                                                   | no       | Compatibility alias for `head_limit`.                   |

## `shell`

Enabled via `tools.shell.enabled`. Executes shell commands on the local machine (or through an ACP host's terminal backend when advertised). Supports single or multiple commands, sequential or parallel execution, per-command options, working directories, stdin, and timeouts.

| Argument        | Type                                       | Required | Description                                           |
| --------------- | ------------------------------------------ | -------- | ----------------------------------------------------- |
| `command`       | string, command object, or array of either | yes      | `{ command, timeout?, work_dir?, stdin? }` per entry. |
| `parallel`      | boolean                                    | no       | Execute multiple commands in parallel.                |
| `ignore_errors` | boolean                                    | no       | Continue executing even if a command fails.           |
| `timeout`       | number (seconds)                           | no       | Default timeout for each command (900s default).      |
| `work_dir`      | string                                     | no       | Base working directory for command execution.         |

## `fetch`

Enabled via `tools.fetch.enabled`. Fetches a remote `http(s)://` URL and returns response content; HTML is simplified to Markdown by default (via Readability + Turndown) to save context. Localhost/loopback and private-network addresses are rejected.

| Argument      | Type                     | Required | Description                                              |
| ------------- | ------------------------ | -------- | -------------------------------------------------------- |
| `url`         | string (URL)             | yes      | Remote HTTP(S) URL to fetch.                             |
| `max_length`  | integer                  | no       | Maximum characters to return (default 5000).             |
| `start_index` | integer                  | no       | Start returning content from this character index.       |
| `raw`         | boolean                  | no       | Return raw response text instead of simplified Markdown. |
| `timeout`     | number (seconds)         | no       | Request timeout (default 30s).                           |
| `headers`     | `Record<string, string>` | no       | Extra HTTP headers.                                      |

## `web_search`

Enabled via `search.enabled`; the active provider and its options are configured under [Search](/hooman/guides/configuration/search/). Returns normalized results.

| Argument                  | Type                                   | Required | Description                                      |
| ------------------------- | -------------------------------------- | -------- | ------------------------------------------------ |
| `query`                   | string (max 400 chars)                 | yes      | Search query.                                    |
| `count`                   | integer (1–20)                         | no       | Result count (default 5).                        |
| `freshness`               | `"day" \| "week" \| "month" \| "year"` | no       | Mutually exclusive with `start_date`/`end_date`. |
| `start_date` / `end_date` | string (`YYYY-MM-DD`)                  | no       | Must be provided together.                       |
| `country`                 | string (2-letter code)                 | no       | Country code.                                    |
| `safe_search`             | boolean                                | no       | Safe search toggle.                              |

## `update_todos`

Enabled via `tools.todo.enabled`. Creates and updates a structured todo list for the current work — the same list backing the chat status bar's todo tracker.

| Argument | Type                                                                          | Required | Description                 |
| -------- | ----------------------------------------------------------------------------- | -------- | --------------------------- |
| `todos`  | `{ content, status: "pending" \| "in_progress" \| "completed", priority? }[]` | yes      | Full replacement todo list. |

## `sleep`

Enabled via `tools.sleep.enabled`. Waits for a specified duration without holding a shell process; cancellable by the user.

| Argument  | Type            | Required | Description                                |
| --------- | --------------- | -------- | ------------------------------------------ |
| `seconds` | number (0–3600) | yes      | How long to wait, in seconds (max 1 hour). |

## `think`

Always registered (approval-exempt). A sequential-thinking tool for breaking complex work into steps, revising earlier thinking, and branching into alternatives.

| Argument            | Type    | Required | Description                                                   |
| ------------------- | ------- | -------- | ------------------------------------------------------------- |
| `thought`           | string  | yes      | The current thinking step.                                    |
| `nextThoughtNeeded` | boolean | yes      | Whether another thought step is needed.                       |
| `thoughtNumber`     | integer | yes      | Current thought number.                                       |
| `totalThoughts`     | integer | yes      | Current estimate of total thoughts needed.                    |
| `isRevision`        | boolean | no       | Whether this thought revises previous thinking.               |
| `revisesThought`    | integer | no       | Which prior thought is being reconsidered.                    |
| `branchFromThought` | integer | no       | Thought number this branch diverges from.                     |
| `branchId`          | string  | no       | Identifier for the current branch.                            |
| `needsMoreThoughts` | boolean | no       | Whether more thoughts are needed beyond the current estimate. |

## `get_current_time` / `convert_time`

Always registered. The system prompt only carries the session-start date & time, so use `get_current_time` whenever the precise current time matters.

| Tool               | Argument          | Type   | Required | Description                                         |
| ------------------ | ----------------- | ------ | -------- | --------------------------------------------------- |
| `get_current_time` | `timezone`        | string | no       | IANA timezone name. Defaults to the local timezone. |
| `convert_time`     | `source_timezone` | string | no       | Source IANA timezone. Defaults to local.            |
| `convert_time`     | `time`            | string | yes      | Time to convert, 24-hour `HH:MM`.                   |
| `convert_time`     | `target_timezone` | string | no       | Target IANA timezone. Defaults to local.            |

## `search_tools`

Search connected MCP tools using a short natural-language query. Built-in tools are already available directly; this tool only searches MCP-discovered tools that Hooman keeps hidden until activated to save context.

| Argument | Type    | Required | Description                                             |
| -------- | ------- | -------- | ------------------------------------------------------- |
| `query`  | string  | yes      | Natural-language query for the MCP capability you need. |
| `limit`  | integer | no       | Maximum results to return (default `5`, max `10`).      |

Returns a ranked result list containing each MCP tool's `name`, `description`, `server`, `readOnly`, `args`, `modes`, plus whether it is already active.

## `activate_tools`

Activate one or more connected MCP tools by name so they become available on the next model cycle in the current session. This only applies to MCP-discovered tools; built-in tools do not need activation.

| Argument | Type     | Required | Description                              |
| -------- | -------- | -------- | ---------------------------------------- |
| `names`  | string[] | yes      | MCP tool names to activate (1-10 names). |

Activation is session-scoped. Tools that are blocked by the current session mode are skipped instead of being exposed.

## `ask_user`

Always registered (no config toggle) — approval-exempt, since the question itself is the interaction. Lets the agent ask a multiple-choice question mid-task and wait for the answer; the user may pick an option, type a free-form answer, or dismiss.

| Argument   | Type     | Required | Description                                         |
| ---------- | -------- | -------- | --------------------------------------------------- |
| `question` | string   | yes      | The question to present to the user.                |
| `options`  | string[] | yes      | 2–5 short answer choices, recommended option first. |

### Across surfaces

| Surface                                  | Presentation                                                                                                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat`                                   | Inline picker in the composer chrome, with free-text answer and dismiss.                                                                                       |
| `exec`                                   | Numbered readline prompt when a TTY is present.                                                                                                                |
| ACP clients (Zed, the VS Code extension) | A question-styled permission card whose options are the answer choices plus Dismiss.                                                                           |
| `daemon`                                 | Relayed to the originating MCP server when it supports `hooman/channel/ask` (see [MCP Channels](/hooman/guides/mcp/channels/)); otherwise `no_user_available`. |
| Non-TTY `exec`, subagents                | No user available — the tool returns `no_user_available` and the agent proceeds on its own judgement.                                                          |

Dismissals return `dismissed` rather than an error.

For a `daemon` turn whose originating channel supports `hooman/channel/ask`, Hooman sends the server the question, the answer options, and the channel's origin metadata (`source`, `user`, `session`, `thread`); the server surfaces it to the human on the channel and posts back either a chosen option, a free-text answer, or a dismissal. If the relay is unsupported, fails, or times out, the tool falls back to `no_user_available` so the agent proceeds on its own judgement.

## `enter_plan_mode` / `exit_plan_mode`

Always registered, but only usable in `agent`/`plan` [session mode](/hooman/guides/cli/#session-mode). `enter_plan_mode` opens (or reopens) a single Markdown plan document for the session to fill in with findings, trade-offs, and intended steps; `exit_plan_mode` is a proposal to leave planning that the user approves or declines.

| Tool              | Argument | Type    | Required | Description                                                                  |
| ----------------- | -------- | ------- | -------- | ---------------------------------------------------------------------------- |
| `enter_plan_mode` | `reason` | string  | no       | Why planning is being entered.                                               |
| `enter_plan_mode` | `fresh`  | boolean | no       | Start a brand-new plan document instead of reopening the session's last one. |
| `exit_plan_mode`  | —        | —       | —        | No arguments.                                                                |

`enter_plan_mode` is approval-exempt; `exit_plan_mode` flows through the approval prompt below (with the drafted plan shown as a preview) so the user can approve or decline before implementation starts. Leaving plan mode always requires that explicit approval — Yolo / auto-approve never skips it.

### Plan file shape

Plan documents use YAML frontmatter with at least `name`, `overview`, and an implementation `tasks` checklist (not a log of planning activity). Each task prefers `content` (or `description`), optional `priority`, and `status` of `pending` / `in_progress` / `completed`:

```yaml
---
name: Plan
overview: Short summary of the implementation approach
tasks:
  - content: First concrete implementation step
    status: pending
    priority: high
  - content: Add focused verification for the changed behavior
    status: pending
    priority: medium
---
```

In agent mode, those tasks seed `update_todos` so the chat checklist stays aligned with the plan. The [VS Code](/hooman/guides/vscode/) plan editor surfaces the same checklist live.

## Browser (Playwright MCP)

Enabled via `tools.browser.enabled` (default **`false`**). When on, Hooman injects a default [Playwright MCP](https://github.com/microsoft/playwright-mcp) server (`@playwright/mcp`) into the session and includes browser-oriented guidance in the system prompt. There is no separate first-party `browser_*` tool API — the agent uses the MCP tools that Playwright exposes (navigate, click, snapshot, and so on), discovered and activated like any other MCP tools via `search_tools` / `activate_tools`.

See [Configuration → Tools](/hooman/guides/configuration/tools/) to flip the toggle, and [MCP](/hooman/guides/mcp/) for how lazy MCP discovery works.

## Subagents

Enabled via `tools.subagents.enabled`. Built-in, read-only, approval-exempt subagent tools that delegate a focused task to a specialized child agent with a narrower tool set (`read_file`, `read_multiple_files`, `list_directory`, `directory_tree`, `grep`, `get_file_info`, `fetch`, `web_search`, `think`).

| Tool                         | Description                                                  |
| ---------------------------- | ------------------------------------------------------------ |
| `subagent_research`          | Explores the workspace to gather information.                |
| `subagent_review`            | Reviews code, changes, and plans for risks and regressions.  |
| `subagent_test_investigator` | Investigates test/build behaviors and likely failure causes. |

All three take a single argument:

| Argument | Type   | Required | Description                   |
| -------- | ------ | -------- | ----------------------------- |
| `query`  | string | yes      | The focused task to delegate. |

## Approvals

By default, Hooman asks for approval before running tools that write, execute, or otherwise act with side effects (`shell`, `write_file`, `edit_file`, `create_directory`, `move_file`, `exit_plan_mode`, etc.). Read-only and internal tools — `think`, `update_todos`, `sleep`, `ask_user`, `search_tools`, `activate_tools`, `get_current_time`, `convert_time`, `directory_tree`, `get_file_info`, `list_directory`, `grep`, `enter_plan_mode`, and the subagent tools — are always allowed and never prompt. Filesystem reads/writes under trusted app-home directories (`~/.hooman/projects/<uuid>/attachments`, and plan-mode writes under `~/.hooman/projects/<uuid>/plans`) are also implicitly allowed.

When a user approves with "always", Hooman persists a reusable rule to `~/.hooman/allowlist.json`: shell commands are broadened to a command-prefix pattern (e.g. `git log *`), filesystem tools are scoped to the exact resolved path, and argument-less tools are allowed tool-wide.

### Surfaces

- **`chat`** renders an inline approval prompt in the composer chrome.
- **`exec`** prompts on the TTY (when present).
- **ACP clients** (Zed, the VS Code extension) receive a `session/request_permission` request, rendered as a permission card.
- **`daemon`** has no local human to prompt: it relays the approval request back to the originating MCP server if that server supports `hooman/channel/permission`; otherwise the tool call is denied. See [MCP Channels](/hooman/guides/mcp/channels/).

`--yolo` on `exec`, `chat`, or `daemon` (and the ACP/VS Code **Yolo** boolean toggle) bypasses all of the above and auto-approves every tool call — use only in trusted environments and with prompts you trust. The one exception is `exit_plan_mode`, which always prompts. Tool approvals (including the on-disk allowlist) are session/machine-scoped and are **not** persisted in `config.json`.

### MCP channels

For a `daemon` turn whose originating channel supports `hooman/channel/permission`, Hooman sends the server a remote approval request carrying the tool name, a truncated description, a truncated JSON preview of the input, and the channel's origin metadata (`source`, `user`, `session`, `thread`). The server's response maps back to a decision:

| Remote response | Local effect                                              |
| --------------- | --------------------------------------------------------- |
| `allow_once`    | The tool call proceeds this one time.                     |
| `allow_always`  | The tool call proceeds and is persisted to the allowlist. |
| anything else   | The tool call is denied.                                  |

If the job's `appState.origin` is missing a channel server, or that server doesn't advertise the capability, the tool call is denied outright rather than falling back to a local prompt (there's no local human in daemon mode).
