---
name: hooman-mcp
description: Read and update Hooman's mcp.json directly. Use when the user asks to list, add, update, remove, or configure MCP servers for Hooman, including stdio, streamable-http, and SSE transports.
---

# Hooman MCP

Use this skill when the user asks you to inspect or change Hooman's MCP server configuration.

## Source Of Truth

- Hooman MCP servers are stored in `~/.hooman/mcp.json`.
- The file contains one top-level object: `mcpServers`.
- Each key under `mcpServers` is the server name.
- Each value is a transport object.

Minimal valid file:

```json
{
  "mcpServers": {}
}
```

## Read/Write Rules

1. Read `~/.hooman/mcp.json` before changing it. If it does not exist, create it with `{"mcpServers": {}}`.
2. Preserve existing servers unless the user explicitly asks to replace or delete them.
3. Make the smallest JSON edit needed: add, update, or remove one server entry.
4. Keep JSON valid. Comments are not supported.
5. Treat `env` and `headers` as potentially secret-bearing maps. Do not expose or rewrite secrets unnecessarily.
6. Use stable, descriptive server names such as `filesystem`, `slack`, `jira`, or `github`.
7. Any change to `mcp.json` requires restarting the running Hooman agent/session before MCP server tools or instructions change.

## File Shape

```json
{
  "mcpServers": {
    "server-name": {
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

Supported transport `type` values:

```json
["stdio", "streamable-http", "sse"]
```

## Stdio Servers

Use `stdio` for local subprocess-based MCP servers.

Required:

- `type`: `"stdio"`
- `command`: executable command, for example `npx`, `node`, `python`, `uvx`, or an absolute binary path

Optional:

- `args`: command arguments as an array of strings
- `env`: environment variables as string key/value pairs
- `cwd`: working directory for the server process

Example:

```json
{
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

Example with `cwd`:

```json
{
  "mcpServers": {
    "local-app": {
      "type": "stdio",
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "cwd": "/Users/me/project",
      "env": {
        "API_KEY": "..."
      }
    }
  }
}
```

## Streamable HTTP Servers

Use `streamable-http` for modern remote HTTP MCP servers.

Required:

- `type`: `"streamable-http"`
- `url`: full HTTP or HTTPS URL

Optional:

- `headers`: HTTP headers as string key/value pairs

Example:

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

## SSE Servers

Use `sse` only for legacy remote MCP servers that still require SSE.

Required:

- `type`: `"sse"`
- `url`: full HTTP or HTTPS URL

Optional:

- `headers`: HTTP headers as string key/value pairs

Example:

```json
{
  "mcpServers": {
    "legacy": {
      "type": "sse",
      "url": "https://example.com/sse",
      "headers": {
        "Authorization": "Bearer ..."
      }
    }
  }
}
```

## Common Edits

Add a server by inserting a new entry under `mcpServers`:

```json
{
  "mcpServers": {
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "..."
      }
    }
  }
}
```

Update a server by replacing only that server's object:

```json
{
  "mcpServers": {
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "...",
        "GITHUB_TOOLSETS": "repos,issues,pull_requests"
      }
    }
  }
}
```

Delete a server by removing its key from `mcpServers`.

## Notes

- Prefer `streamable-http` over `sse` for remote servers unless the user specifically needs SSE.
- For bearer tokens, use `headers.Authorization`.
- For local subprocess secrets, use `env`.
- If a server package's README gives a specific JSON block, adapt it into the `mcpServers` object and preserve the required command, args, env, URL, and headers.
