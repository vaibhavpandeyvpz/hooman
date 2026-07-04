---
title: Overview
description: MCP server types, instructions, and OAuth (DCR/CIMD) for Hooman's MCP client.
---

Hooman connects to Model Context Protocol (MCP) servers for on-demand tools, and to servers that advertise the experimental `hooman/channel` capability for event-driven automation via `hooman daemon` — see [Channels](/hooman/guides/mcp/channels/).

`mcp.json` is stored as:

```json
{
  "mcpServers": {}
}
```

At runtime, project-local `.hooman/mcp.json` files are merged on top of `~/.hooman/mcp.json` from git root to the current directory. On name conflicts, the nearest `mcpServers.<name>` entry wins — see [repo-local overlays](/hooman/guides/configuration/#repo-local-runtime-overlays).

## Server types

### stdio

```json
{
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "env": { "EXAMPLE": "1" },
      "cwd": "/tmp"
    }
  }
}
```

### streamable-http

```json
{
  "mcpServers": {
    "remote": {
      "type": "streamable-http",
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer token" }
    }
  }
}
```

### sse

```json
{
  "mcpServers": {
    "legacy": {
      "type": "sse",
      "url": "https://example.com/sse",
      "headers": { "Authorization": "Bearer token" }
    }
  }
}
```

## OAuth

Remote servers can require authorization. Hooman supports Dynamic Client Registration and Client ID Metadata Documents in addition to static clients.

```json
{
  "mcpServers": {
    "linear": {
      "type": "streamable-http",
      "url": "https://example.com/mcp",
      "oauth": {
        "enabled": true,
        "clientId": "optional-pre-registered-client",
        "scopes": ["read", "write"],
        "callbackPort": 19876
      }
    }
  }
}
```

### How the client identity is established

When authorizing a remote server, the MCP SDK needs a `client_id`. Hooman resolves one in this order:

1. **Pre-registered client** — if `oauth.clientId` (and optionally `clientSecret`) is set, it's used as-is and no registration happens.
2. **Dynamic Client Registration (DCR)** — if the auth server advertises a `registration_endpoint`, Hooman registers a client on the fly. The redirect URI it registers is reused on later authorizations (persisted in `~/.hooman/mcp-oauth.json`), so keep it stable — set `oauth.callbackPort` or `oauth.redirectUri` if a server pins the redirect.
3. **Client ID Metadata Document (CIMD / SEP-991)** — some servers (e.g. Slack) support neither a static client nor DCR, and instead advertise `client_id_metadata_document_supported: true`. For these, the client presents an HTTPS URL that hosts a JSON metadata document; that URL becomes the `client_id`. Hooman sends `oauth.clientMetadataUrl` (falling back to a bundled default) whenever the server supports it.

If a server supports none of these, authorization fails with `Incompatible auth server: does not support dynamic client registration` — supply a `clientId` or `clientMetadataUrl`.

### Hosting a CIMD document

The metadata document is a static JSON file served over HTTPS. A copy ships in this repo at [`docs/public/oauth/client-metadata.json`](https://github.com/vaibhavpandeyvpz/hooman/blob/main/docs/public/oauth/client-metadata.json) and is published via this site at `https://vaibhavpandey.com/hooman/oauth/client-metadata.json`, which is the default `clientMetadataUrl`.

Requirements when hosting your own:

- The URL must be **HTTPS with a non-root path** (a bare domain is rejected).
- The document's own `client_id` field must equal the hosted URL **exactly** (self-referential).
- `redirect_uris` must include Hooman's loopback callback path `/mcp/oauth/callback`. Per RFC 8252 the loopback port is matched flexibly, so list the port-less hosts (`http://127.0.0.1/mcp/oauth/callback` and `http://localhost/mcp/oauth/callback`).
- `token_endpoint_auth_method` is `"none"` (public client — the document is public and holds no secrets).

Override the default per server:

```json
{
  "mcpServers": {
    "slack": {
      "type": "streamable-http",
      "url": "https://mcp.slack.com/mcp",
      "oauth": {
        "enabled": true,
        "clientMetadataUrl": "https://vaibhavpandey.com/hooman/oauth/client-metadata.json"
      }
    }
  }
}
```

### Auth commands

```bash
hooman mcp auth <server>                # OAuth login for a configured MCP server
hooman mcp logout <server>              # Clear stored OAuth credentials
hooman mcp logout <server> --scope all  # Scope: all, client, tokens, discovery
hooman mcp auth-status                  # Show MCP server auth status
```

## Instructions

MCP server `instructions` from the protocol `initialize` response are appended to Hooman's system prompt, after local `instructions.md` and session-specific prompt overrides. Hooman reads these automatically from every connected server.

## Next: Channels

For event-driven automation — `hooman daemon`, the `hooman/channel` capability, and suggested ecosystem servers — see [Channels](/hooman/guides/mcp/channels/).
