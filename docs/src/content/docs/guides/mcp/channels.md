---
title: Channels
description: Event-driven automation with hooman daemon, the hooman/channel capability, and suggested ecosystem servers.
---

In addition to on-demand tools (see [Overview](/hooman/guides/mcp/)), Hooman connects to MCP servers that advertise the experimental `hooman/channel` capability for event-driven automation via `hooman daemon`.

## Channels and automation

`hooman daemon` subscribes to MCP servers that advertise the experimental `hooman/channel` capability (always on — there's no opt-out flag). Hooman also reads `hooman/user`, `hooman/session`, and `hooman/thread` capability paths so daemon turns preserve origin metadata from the source channel.

The daemon is a multi-upstream MCP fan-in host plus ACP router, not one shared agent: it may hold singleton connections to several channel/tool servers at once (Telegram, Slack, WhatsApp, Jira, cron, …), and multiplexes many ACP sessions over one supervised `hooman acp` process instead of invoking a single agent directly.

- **Conversation routing**: each notification's `server:channel:<hooman/session>` (falling back to `--session`, then a stable `server:channel` key) maps to its own ACP session. First message creates it (`session/new`); later messages for the same key reuse it; after it goes idle it's closed (`session/close`) but the mapping is kept so the next message resumes it (`session/resume`) — including across daemon restarts.
- **Ordering and concurrency**: messages for the _same_ conversation key are processed strictly in order; unrelated conversations run fully concurrently, up to `daemon.sessions.max` (default `10`, override with `--max-active-sessions`) concurrently active ACP sessions. A conversation whose session already went idle is evicted (least-recently-used first) to make room for a new one under load, and closes immediately once its turn finishes if another conversation is waiting for a slot — instead of waiting for the ordinary idle timeout (`daemon.sessions.timeout`, default 5 minutes, override with `--session-idle <seconds>`, or `0` to disable ordinary idle close).
- **Tools**: daemon-hosted ACP sessions never load local `mcp.json` directly — each configured MCP server's single upstream connection stays owned by the daemon parent (so servers with exclusive state, like a single Telegram poller, are never connected twice). Tools from every configured server are aggregated behind one local, loopback-only MCP proxy (namespaced `server_slug__tool_name`) that every daemon-hosted ACP session receives as its one session-scoped `mcpServers` entry.
- **Permissions and questions**: tool calls from daemon turns are **not** blanket auto-approved. Hooman resolves the ACP session back to its originating upstream server and relays a remote approval request over that exact server's `hooman/channel/permission` capability (denied if unsupported); the [`ask_user` tool](/hooman/guides/tools/#ask_user) relays the same way over `hooman/channel/ask`. Neither is ever broadcast to other configured servers.
- **Flags**: `daemon` accepts `--session` (fallback conversation id, not `--continue` — it owns many ACP sessions, so "latest session" has no single meaning), `--mode`, `--effort`, `--model`, and `--yolo` (applied to each newly created/resumed session); `--yolo` bypasses approval/ask relaying and allows all tools without prompting.
- **Visibility**: on an interactive terminal, `hooman daemon` renders a live dashboard of idle/in-progress/disposed sessions, queue pressure, and usage instead of a log stream — see [`hooman daemon`](/hooman/guides/cli/#hooman-daemon) for the full breakdown, or pass `--no-dashboard` for plain logs.

The [`ask_user` tool](/hooman/guides/tools/#ask_user) relays through channels the same way: if the originating server advertises `hooman/channel/ask`, Hooman sends it the question and answer options (as a `notifications/hooman/channel/ask_request` notification carrying `request_id`, `question`, `options` as `{id, label}` pairs, and origin `meta`), and the server posts the outcome back as a `notifications/hooman/channel/ask` notification (`request_id` plus an `option_id`, a free-text `answer`, or `dismissed: true`). Servers without the capability simply leave the tool reporting "no user available", and the agent proceeds on its own judgement — questions are never hard-denied the way unapproved tool calls are.

## Ecosystem servers

For the best experience, set up both MCP servers (on-demand tools) and MCP channels (event-driven automation via `hooman daemon`). Suggested servers from this ecosystem:

- [`cronmcp`](https://github.com/vaibhavpandeyvpz/cronmcp) — lets Hooman schedule recurring prompts and automations, so routine checks and follow-ups run on time.
- [`jiraxmcp`](https://github.com/vaibhavpandeyvpz/jiraxmcp) — gives Hooman direct Jira Cloud access to search issues, update tickets, and help drive sprint workflows.
- [`slackxmcp`](https://github.com/vaibhavpandeyvpz/slackxmcp) — connects Hooman to Slack so it can read channel context, draft updates, and post actions where your team already works.
- [`tgfmcp`](https://github.com/vaibhavpandeyvpz/tgfmcp) — enables Telegram bot workflows, making it easy to route notifications and respond from agent-driven chats.
- [`wappmcp`](https://github.com/vaibhavpandeyvpz/wappmcp) — brings WhatsApp Web messaging into Hooman for customer or team communication automations.

For production deployments, review permissions and use least-privilege credentials/tokens for each integration.
