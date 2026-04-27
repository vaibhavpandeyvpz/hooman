---
name: hooman-channels
description: Add and configure Hooman channel MCP servers for cron, Slack, Telegram, WhatsApp, and Jira. Use when the user asks to connect event-driven channels, schedulers, messaging apps, or Jira webhooks to a Hooman agent or daemon.
---

# Hooman Channels

Use this skill when the user asks to add channel-driven MCP integrations to Hooman. Channel servers are normal MCP stdio servers in `~/.hooman/mcp.json` that are started with `--channels`, advertise `hooman/channel`, and emit `notifications/hooman/channel` into `hooman daemon --channels`.

## Source Of Truth

- MCP servers live in `~/.hooman/mcp.json` under top-level `mcpServers`.
- Restart the running Hooman session or daemon after changing `mcp.json`.
- Run the long-lived listener with `hooman daemon --channels`.
- Use `hooman daemon --channels --yolo` only when the user explicitly accepts automatic tool approval risk.

Minimal `mcp.json` shape:

```json
{
  "mcpServers": {}
}
```

## Operating Rules

1. Read `~/.hooman/mcp.json` before editing. If it is missing, create it only with a valid Hooman shape.
2. Preserve unrelated MCP servers, credentials, and allowlists. JSON comments are not supported.
3. Add each channel as a `stdio` server using `command: "npx"` and package args with `-y`.
4. Include `--channels` when the user wants inbound events, daemon automation, permission relay, webhooks, or scheduled prompts.
5. Do not print secrets from config files or environment maps. Use placeholders in explanations.
6. Prefer stable server names: `cron`, `slack`, `telegram`, `whatsapp`, and `jira`.
7. For Slack, Telegram, and WhatsApp, run each package's `configure` command first when local credentials or allowlists are not already configured.
8. For Jira, place credentials in the server `env` map or ensure the daemon's shell environment provides them.

## Common Channel Server Entries

Add any requested entries under `mcpServers`.

Cron scheduler:

```json
{
  "cron": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "cronmcp", "mcp", "--channels"]
  }
}
```

Slack:

```json
{
  "slack": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "slackxmcp", "mcp", "--channels"]
  }
}
```

Telegram:

```json
{
  "telegram": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "tgfmcp", "mcp", "--channels"]
  }
}
```

WhatsApp:

```json
{
  "whatsapp": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "wappmcp", "mcp", "--channels"]
  }
}
```

Jira:

```json
{
  "jira": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "jiraxmcp", "mcp", "--channels"],
    "env": {
      "JIRA_HOST": "https://your-domain.atlassian.net",
      "JIRA_EMAIL": "you@example.com",
      "JIRA_API_TOKEN": "...",
      "JIRA_WEBHOOK_HOST": "127.0.0.1",
      "JIRA_WEBHOOK_PORT": "6543",
      "JIRA_WEBHOOK_SECRET": "..."
    }
  }
}
```

For Jira, either use `JIRA_EMAIL` plus `JIRA_API_TOKEN`, or use `JIRA_ACCESS_TOKEN` instead. `JIRA_WEBHOOK_SECRET` is optional; include it when Jira admin webhooks are configured with a secret.

## Setup By Channel

### Cron

- Requirements: Node.js `24+`.
- Start package: `npx cronmcp mcp --channels`.
- Tools include `cron_list_jobs`, `cron_add_job`, `cron_update_job`, and `cron_remove_job`.
- Schedules are local-time 5-field cron expressions: `minute hour day-of-month month day-of-week`.
- Local state is stored under `~/.cronmcp/`; jobs are JSONL records in `~/.cronmcp/crontab`.
- Limits and behavior: at most 50 jobs, next run must be within one year, recurring jobs auto-expire after 7 days, `once: true` jobs are removed after the first successful tick.
- Channel metadata: `meta.source` is `cron`, `meta.user` is `scheduler`, `meta.session` is the cron job ID, and `meta.thread` is omitted.

Example scheduled prompt request after the server is connected:

```text
Use cron_add_job with schedule "*/15 * * * *" and prompt "Check failed builds and report anything urgent".
```

### Slack

- Requirements: Node.js `24+` and a Slack app with Socket Mode enabled.
- Configure first with `npx slackxmcp configure`; it writes `~/.slackxmcp/config.json`.
- The configure UI manages app token, bot token, user token, allowed users, and allowed channels.
- Minimum Slack app setup: Socket Mode app token with `connections:write`; token scopes for the surfaces used, commonly `channels:read`, `groups:read`, `im:read`, `mpim:read`, history scopes for those surfaces, `chat:write`, `reactions:write`, and `users:read`.
- Add event subscriptions for needed message surfaces, such as `message.channels`, `message.groups`, `message.im`, and `message.mpim`.
- `slack_search_messages` usually requires a user token with `search:read`.
- For permission prompts in Slack, enable Slack app Interactivity so Block Kit button actions are delivered over Socket Mode.
- Channel events obey configured allowlists. If no allowed users or channels are configured, all inbound events are emitted.
- Channel metadata: `meta.source` is `slack`, `meta.user` is the sender user ID, `meta.session` is the conversation ID, and `meta.thread` is the thread timestamp or message timestamp.

### Telegram

- Requirements: Node.js `24+` and a Telegram bot token.
- Configure first with `npx tgfmcp configure`; it writes `~/.tgfmcp/config.json`.
- The configure UI manages bot token, allowed users, and allowed chats.
- To enroll users or chats, use the configure UI's generated short code and send it from the target Telegram user or chat.
- Telegram bots can only interact with chats where the bot has been added, contacted, or otherwise permitted.
- Incoming media is downloaded under `~/.tgfmcp/attachments/` and included as local attachment paths.
- Channel events obey configured allowlists. If no allowed users or chats are configured, all inbound events are emitted.
- Channel metadata: `meta.source` is `telegram`, `meta.user` is the sender identity seed, `meta.session` is the chat identity seed, and `meta.thread` is the Telegram message ID.
- Permission prompts are posted back into the originating chat with inline approval buttons.

### WhatsApp

- Requirements: Node.js `24+` and a local Chrome or Chromium installation that Puppeteer can launch.
- If browser auto-detection fails, set `WAPPMCP_BROWSER_PATH` or `PUPPETEER_EXECUTABLE_PATH`.
- Configure first with `npx wappmcp configure`; it writes `~/.wappmcp/config.json`.
- First login requires scanning a WhatsApp Web QR code. Session data lives under `~/.wappmcp/profile`.
- The configure UI manages connect/disconnect, allowed users, and allowed chats.
- Incoming media and quoted-parent media are downloaded under `~/.wappmcp/attachments/`.
- Channel events obey configured allowlists. If no allowed users or chats are configured, all inbound events are emitted.
- Channel metadata: `meta.source` is `whatsapp`, `meta.user` is the sender identity seed, `meta.session` is the chat identity seed, and `meta.thread` is the WhatsApp message ID.
- Permission prompts are posted back into the originating WhatsApp chat; supported replies are `yes`, `always`, and `no`.

### Jira

- Requirements: Node.js `24+`, Jira Cloud `JIRA_HOST`, and either `JIRA_EMAIL` plus `JIRA_API_TOKEN` or `JIRA_ACCESS_TOKEN`.
- Start package: `npx jiraxmcp mcp --channels`.
- For webhook channels, configure Jira admin webhooks to call `http://your-host:6543/webhook` by default.
- `JIRA_WEBHOOK_PORT` overrides `6543`; `JIRA_WEBHOOK_HOST` defaults to `127.0.0.1`. Use `0.0.0.0` only when the listener must accept traffic from another machine.
- If Jira webhooks use a secret, set `JIRA_WEBHOOK_SECRET`; incoming `X-Hub-Signature` headers are verified before events are emitted.
- Local data is stored under `~/.jiraxmcp/`; downloaded attachments are saved under `~/.jiraxmcp/attachments/`.
- Channel metadata: `meta.source` is `jira`, `meta.user` is the best available Jira actor ID, `meta.session` is usually the issue key, and `meta.thread` is omitted.

## Verification

After setup:

1. Confirm `~/.hooman/mcp.json` contains the requested stdio server entries.
2. Restart Hooman and run `hooman daemon --channels`.
3. Trigger one inbound event: a cron tick, Slack message, Telegram message, WhatsApp message, or Jira webhook.
4. If no event arrives, check the package-specific local config, allowlists, credentials, webhook reachability, and whether the MCP server was started with `--channels`.

## Notes

- `chat` and `exec` can use connected MCP tools on demand, but inbound channel events are processed by `daemon --channels`.
- Slack, Telegram, and WhatsApp support remote channel permission relay. Jira and cron do not advertise permission relay in their README contracts.
- These packages use stdio and are meant to be launched by Hooman, not browsed directly in a terminal.
