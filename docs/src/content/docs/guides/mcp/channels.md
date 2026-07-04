---
title: Channels
description: Event-driven automation with hooman daemon, the hooman/channel capability, and suggested ecosystem servers.
---

In addition to on-demand tools (see [Overview](/hooman/guides/mcp/)), Hooman connects to MCP servers that advertise the experimental `hooman/channel` capability for event-driven automation via `hooman daemon`.

## Channels and automation

`hooman daemon` subscribes to MCP servers that advertise the experimental `hooman/channel` capability (always on — there's no opt-out flag). Hooman also reads `hooman/user`, `hooman/session`, and `hooman/thread` capability paths so daemon turns preserve origin metadata from the source channel.

When a matching notification is received, Hooman uses `params.content` as the prompt if it's a string; otherwise it JSON-stringifies the notification params and sends that to the agent. Daemon mode processes notifications sequentially and reuses the same agent session over time.

Tool calls from daemon turns are **not** blanket auto-approved: if the originating MCP server supports `hooman/channel/permission`, Hooman relays a remote approval request back to that source; otherwise the tool call is denied. `exec`, `chat`, and `daemon` accept `--yolo` to bypass those approval paths and allow all tools without prompting or relay.

The [`ask_user` tool](/hooman/guides/tools/#ask_user) relays through channels the same way: if the originating server advertises `hooman/channel/ask`, Hooman sends it the question and answer options (as a `notifications/hooman/channel/ask_request` notification carrying `request_id`, `question`, `options` as `{id, label}` pairs, and origin `meta`), and the server posts the outcome back as a `notifications/hooman/channel/ask` notification (`request_id` plus an `option_id`, a free-text `answer`, or `dismissed: true`). Servers without the capability simply leave the tool reporting "no user available", and the agent proceeds on its own judgement — questions are never hard-denied the way unapproved tool calls are.

## Ecosystem servers

For the best experience, set up both MCP servers (on-demand tools) and MCP channels (event-driven automation via `hooman daemon`). Suggested servers from this ecosystem:

- [`cronmcp`](https://github.com/vaibhavpandeyvpz/cronmcp) — lets Hooman schedule recurring prompts and automations, so routine checks and follow-ups run on time.
- [`jiraxmcp`](https://github.com/vaibhavpandeyvpz/jiraxmcp) — gives Hooman direct Jira Cloud access to search issues, update tickets, and help drive sprint workflows.
- [`slackxmcp`](https://github.com/vaibhavpandeyvpz/slackxmcp) — connects Hooman to Slack so it can read channel context, draft updates, and post actions where your team already works.
- [`tgfmcp`](https://github.com/vaibhavpandeyvpz/tgfmcp) — enables Telegram bot workflows, making it easy to route notifications and respond from agent-driven chats.
- [`wappmcp`](https://github.com/vaibhavpandeyvpz/wappmcp) — brings WhatsApp Web messaging into Hooman for customer or team communication automations.

For production deployments, review permissions and use least-privilege credentials/tokens for each integration.
