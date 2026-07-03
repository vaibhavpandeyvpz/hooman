# Channel Setup Reference

Per-channel `mcp.json` entries, requirements, and setup details. Add requested entries under top-level `mcpServers`.

## Cron

```json
{
  "cron": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "cronmcp", "mcp", "--channels"]
  }
}
```

- Requirements: Node.js `24+`.
- Tools include `cron_list_jobs`, `cron_add_job`, `cron_update_job`, and `cron_remove_job`.
- Schedules are local-time 5-field cron expressions: `minute hour day-of-month month day-of-week`.
- Local state is stored under `~/.cronmcp/`; jobs are JSONL records in `~/.cronmcp/crontab`.
- Limits and behavior: at most 50 jobs, next run must be within one year, recurring jobs auto-expire after 7 days, `once: true` jobs are removed after the first successful tick.
- Channel metadata: `meta.source` is `cron`, `meta.user` is `scheduler`, `meta.session` is the cron job ID, and `meta.thread` is omitted.

Example scheduled prompt request after the server is connected:

```text
Use cron_add_job with schedule "*/15 * * * *" and prompt "Check failed builds and report anything urgent".
```

## Slack

```json
{
  "slack": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "slackxmcp", "mcp", "--channels"]
  }
}
```

- Requirements: Node.js `24+` and a Slack app with Socket Mode enabled.
- Configure first with `npx slackxmcp configure`; it writes `~/.slackxmcp/config.json`. The configure UI manages app token, bot token, user token, allowed users, and allowed channels.
- Minimum Slack app setup: Socket Mode app token with `connections:write`; token scopes for the surfaces used, commonly `channels:read`, `groups:read`, `im:read`, `mpim:read`, history scopes for those surfaces, `chat:write`, `reactions:write`, and `users:read`.
- Add event subscriptions for needed message surfaces, such as `message.channels`, `message.groups`, `message.im`, and `message.mpim`.
- `slack_search_messages` usually requires a user token with `search:read`.
- For permission prompts in Slack, enable Slack app Interactivity so Block Kit button actions are delivered over Socket Mode.
- Channel events obey configured allowlists. If no allowed users or channels are configured, all inbound events are emitted.
- Channel metadata: `meta.source` is `slack`, `meta.user` is the sender user ID, `meta.session` is the conversation ID, and `meta.thread` is the thread timestamp or message timestamp.

## Telegram

```json
{
  "telegram": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "tgfmcp", "mcp", "--channels"]
  }
}
```

- Requirements: Node.js `24+` and a Telegram bot token.
- Configure first with `npx tgfmcp configure`; it writes `~/.tgfmcp/config.json`. The configure UI manages bot token, allowed users, and allowed chats.
- To enroll users or chats, use the configure UI's generated short code and send it from the target Telegram user or chat.
- Telegram bots can only interact with chats where the bot has been added, contacted, or otherwise permitted.
- Incoming media is downloaded under `~/.tgfmcp/attachments/` and included as local attachment paths.
- Channel events obey configured allowlists. If no allowed users or chats are configured, all inbound events are emitted.
- Channel metadata: `meta.source` is `telegram`, `meta.user` is the sender identity seed, `meta.session` is the chat identity seed, and `meta.thread` is the Telegram message ID.
- Permission prompts are posted back into the originating chat with inline approval buttons.

## WhatsApp

```json
{
  "whatsapp": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "wappmcp", "mcp", "--channels"]
  }
}
```

- Requirements: Node.js `24+` and a local Chrome or Chromium installation that Puppeteer can launch. If browser auto-detection fails, set `WAPPMCP_BROWSER_PATH` or `PUPPETEER_EXECUTABLE_PATH`.
- Configure first with `npx wappmcp configure`; it writes `~/.wappmcp/config.json`. The configure UI manages connect/disconnect, allowed users, and allowed chats.
- First login requires scanning a WhatsApp Web QR code. Session data lives under `~/.wappmcp/profile`.
- Incoming media and quoted-parent media are downloaded under `~/.wappmcp/attachments/`.
- Channel events obey configured allowlists. If no allowed users or chats are configured, all inbound events are emitted.
- Channel metadata: `meta.source` is `whatsapp`, `meta.user` is the sender identity seed, `meta.session` is the chat identity seed, and `meta.thread` is the WhatsApp message ID.
- Permission prompts are posted back into the originating WhatsApp chat; supported replies are `yes`, `always`, and `no`.

## Jira

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

- Requirements: Node.js `24+`, Jira Cloud `JIRA_HOST`, and either `JIRA_EMAIL` plus `JIRA_API_TOKEN` or `JIRA_ACCESS_TOKEN`.
- For webhook channels, configure Jira admin webhooks to call `http://your-host:6543/webhook` by default.
- `JIRA_WEBHOOK_PORT` overrides `6543`; `JIRA_WEBHOOK_HOST` defaults to `127.0.0.1`. Use `0.0.0.0` only when the listener must accept traffic from another machine.
- If Jira webhooks use a secret, set `JIRA_WEBHOOK_SECRET`; incoming `X-Hub-Signature` headers are verified before events are emitted. Otherwise it is optional.
- Local data is stored under `~/.jiraxmcp/`; downloaded attachments are saved under `~/.jiraxmcp/attachments/`.
- Channel metadata: `meta.source` is `jira`, `meta.user` is the best available Jira actor ID, `meta.session` is usually the issue key, and `meta.thread` is omitted.
