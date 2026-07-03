---
name: hooman-channels
description: Add and configure Hooman channel MCP servers for cron, Slack, Telegram, WhatsApp, and Jira in ~/.hooman/mcp.json. Use when the user asks for scheduled or recurring prompts, cron jobs, messaging-app or chatbot integration, inbound webhooks, daemon automation, or connecting any event-driven channel to a Hooman agent or daemon. For ordinary (non-channel) MCP server edits use hooman-mcp.
---

# Hooman Channels

Use this skill when the user asks to add channel-driven MCP integrations to Hooman. Channel servers are normal MCP stdio servers in `~/.hooman/mcp.json` that are started with `--channels`, advertise `hooman/channel`, and emit `notifications/hooman/channel` into `hooman daemon --channels`.

## Source Of Truth

- MCP servers live in `~/.hooman/mcp.json` under top-level `mcpServers` (minimal shape: `{"mcpServers": {}}`).
- Restart the running Hooman session or daemon after changing `mcp.json`.
- Run the long-lived listener with `hooman daemon --channels`. Use `--yolo` only when the user explicitly accepts automatic tool approval risk.

## Reference File

Read `channels.md` (next to this SKILL.md) for the exact `mcpServers` JSON entry, requirements, configure steps, allowlists, metadata shape, and webhook/credential details of each channel before adding or troubleshooting it. Supported channels and packages:

- `cron` — `cronmcp` (scheduler)
- `slack` — `slackxmcp`
- `telegram` — `tgfmcp`
- `whatsapp` — `wappmcp`
- `jira` — `jiraxmcp` (webhooks; credentials via server `env`)

## Operating Rules

1. Read `~/.hooman/mcp.json` before editing. If it is missing, create it only with a valid Hooman shape.
2. Preserve unrelated MCP servers, credentials, and allowlists. JSON comments are not supported.
3. Add each channel as a `stdio` server using `command: "npx"` and package args with `-y`.
4. Include `--channels` when the user wants inbound events, daemon automation, permission relay, webhooks, or scheduled prompts.
5. Do not print secrets from config files or environment maps. Use placeholders in explanations.
6. Prefer stable server names: `cron`, `slack`, `telegram`, `whatsapp`, and `jira`.
7. For Slack, Telegram, and WhatsApp, run each package's `configure` command first when local credentials or allowlists are not already configured.
8. For Jira, place credentials in the server `env` map or ensure the daemon's shell environment provides them.

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
