---
name: hooman-mcp
description: Read and update Hooman's ~/.hooman/mcp.json. Use when the user asks to list, add, update, remove, or configure MCP servers for Hooman — stdio commands, streamable-http or SSE URLs, env vars, and auth headers. For event-driven channel servers (cron, Slack, Telegram, WhatsApp, Jira) use hooman-channels instead; for config.json settings use hooman-config.
---

# Hooman MCP

Use this skill when the user asks you to inspect or change Hooman's MCP server configuration.

## Source Of Truth

- Hooman MCP servers are stored in `~/.hooman/mcp.json`: one top-level `mcpServers` object where each key is a server name and each value is a transport object.
- Minimal valid file: `{"mcpServers": {}}`.

## Read/Write Rules

1. Read `~/.hooman/mcp.json` before changing it. If it does not exist, create it with `{"mcpServers": {}}`.
2. Preserve existing servers unless the user explicitly asks to replace or delete them.
3. Make the smallest JSON edit needed: add, update, or remove one server entry. Keep JSON valid; comments are not supported.
4. Treat `env` and `headers` as potentially secret-bearing maps. Do not expose or rewrite secrets unnecessarily.
5. Use stable, descriptive server names such as `filesystem`, `slack`, `jira`, or `github`.
6. Any change to `mcp.json` requires restarting the running Hooman agent/session before MCP server tools or instructions change.

## Transports

Supported `type` values: `"stdio"`, `"streamable-http"`, `"sse"`.

### Stdio (local subprocess servers)

Required: `type: "stdio"` and `command` (e.g. `npx`, `node`, `python`, `uvx`, or an absolute binary path). Optional: `args` (string array), `env` (string map), `cwd` (working directory).

```json
{
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "env": {
        "TOKEN": "..."
      },
      "cwd": "/optional/working/directory"
    }
  }
}
```

### Streamable HTTP (modern remote servers)

Required: `type: "streamable-http"` and `url` (full HTTP/HTTPS URL). Optional: `headers` (string map).

```json
{
  "mcpServers": {
    "remote": {
      "type": "streamable-http",
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer ..."
      }
    }
  }
}
```

### SSE (legacy remote servers)

Same shape as `streamable-http` but with `type: "sse"`. Use only for legacy remote MCP servers that still require SSE.

## Common Edits

- Add a server by inserting a new entry under `mcpServers`.
- Update a server by replacing only that server's object (e.g. adding a key to its `env`).
- Delete a server by removing its key from `mcpServers`.

## Notes

- Prefer `streamable-http` over `sse` for remote servers unless the user specifically needs SSE.
- For bearer tokens, use `headers.Authorization`; for local subprocess secrets, use `env`.
- If a server package's README gives a specific JSON block, adapt it into the `mcpServers` object and preserve the required command, args, env, URL, and headers.

## CLI Commands

Hooman ships `mcp` subcommands for OAuth-related maintenance of servers already defined in `~/.hooman/mcp.json`. These only apply to remote (`streamable-http`/`sse`) servers configured with OAuth — they do not add, remove, or edit server entries (that's a direct `mcp.json` edit, per above).

```bash
hooman mcp auth <server> # OAuth login for a configured MCP server
hooman mcp logout <server> # Clear stored OAuth credentials (defaults to scope "all")
hooman mcp logout <server> --scope all # Clear discovery, client registration, and tokens
hooman mcp logout <server> --scope client # Clear only the registered OAuth client
hooman mcp logout <server> --scope tokens # Clear only the stored access/refresh tokens
hooman mcp logout <server> --scope discovery # Clear only cached OAuth server metadata
hooman mcp auth-status # Show OAuth status for all configured MCP servers
```

- `<server>` must match a key under `mcpServers` in `mcp.json`.
- `hooman mcp auth` starts the OAuth flow (opening a local callback server as needed) and stores credentials in `~/.hooman/mcp-oauth.json`.
- `hooman mcp logout` clears stored OAuth state without touching `mcp.json`; use it before re-authenticating with different credentials or when decommissioning a server.
- `hooman mcp auth-status` reports each server's OAuth state (e.g. authenticated, expired, not authenticated) without making network calls to the server itself beyond what's needed to read stored state.
- These commands operate on the home config (`~/.hooman/mcp.json`) only, not repo-local `.hooman/mcp.json` overlays.
