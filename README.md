<div align="center">
  <img src=".github/logo.svg" alt="Hooman logo" width="128" />
  <h1>Hooman</h1>
  <p>
    Hooman is a hackable AI agent toolkit for local workflows. It is built with TypeScript, <a href="https://www.npmjs.com/package/@strands-agents/sdk">Strands Agents SDK</a>, and <a href="https://github.com/vadimdemedes/ink">Ink</a>.
  </p>
  <p>
    <a href="https://nodejs.org"><img src="https://img.shields.io/badge/runtime-Node.js-5FA04E?logo=nodedotjs&logoColor=white" alt="Node.js" /></a>
    <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/language-TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript" /></a>
    <a href="https://github.com/vadimdemedes/ink"><img src="https://img.shields.io/badge/ui-Ink-6f42c1" alt="Ink" /></a>
    <a href="https://github.com/vaibhavpandeyvpz/hooman/actions/workflows/publish-npm.yml"><img src="https://img.shields.io/github/actions/workflow/status/vaibhavpandeyvpz/hooman/publish-npm.yml?branch=main&label=build" alt="Build" /></a>
    <a href="https://github.com/vaibhavpandeyvpz/hooman/stargazers"><img src="https://img.shields.io/github/stars/vaibhavpandeyvpz/hooman?style=flat" alt="GitHub Repo stars" /></a>
    <a href="https://github.com/vaibhavpandeyvpz/hooman/commits/main"><img src="https://img.shields.io/github/last-commit/vaibhavpandeyvpz/hooman" alt="GitHub last commit" /></a>
  </p>
  <p>
    <img src=".github/screenshot.png" alt="Hooman screenshot" />
  </p>
</div>

It gives you a practical toolkit to build and run agent workflows:

- a one-shot `exec` command for single prompts
- a stateful `chat` interface for iterative sessions
- a `daemon` command for channel-driven MCP automation
- an in-chat `/config` workflow (Ink-powered) for general settings, models, MCP servers, and installed skills
- an `acp` command for running Hooman as an Agent Client Protocol (ACP) agent over stdio

## Related

**Looking for a focused web UI** for chat and agent configuration with lighter surface on top of the same stack? See [**Zero**](https://github.com/vaibhavpandeyvpz/zero) — [README](https://github.com/vaibhavpandeyvpz/zero#readme).

## Features

- Multiple LLM providers: `anthropic`, `azure`, `bedrock`, `google`, `groq`, `minimax`, `moonshot`, `ollama`, `openai`, `openrouter`, `xai`
- Local configuration under `~/.hooman`
- Optional web search tool with provider selection (`brave`, `exa`, `firecrawl`, `serper`, or `tavily`)
- MCP server support via `stdio`, `streamable-http`, and `sse`
- MCP server `instructions` support: server-provided instructions are appended to the agent system prompt
- MCP channel notifications: `hooman daemon` subscribes to servers that advertise `hooman/channel`
- Runtime skills via Strands `AgentSkills`, loading bundled built-in skills plus local `~/.hooman/skills`
- Bundled prompt harness toggles (`behaviour`, `communication`, `execution`, `guardrails`); coding guidance ships as the built-in `hooman-coding` skill
- Built-in read-only subagent tools (`subagent_research`, `subagent_review`, `subagent_test_investigator`)
- Built-in `grep` tool backed by ripgrep (`rg`), with runtime bootstrap when `rg` is not available on PATH
- Built-in `ask_user` tool: the agent can ask you a multiple-choice question mid-task and wait for the answer — inline picker in `chat`, numbered prompt in `exec`, question card in ACP clients (Zed, the VS Code extension); environments without a human (daemon, non-TTY `exec`, subagents) report "no user available" so the agent proceeds on its own
- Context-window utilization and session-cost tracking backed by [models.dev](https://models.dev) (daily-cached catalog, optional per-model `billing` overrides) — shown in the chat status bar, the VS Code extension footer, and sent to ACP clients via `usage_update`
- Toolkit-oriented architecture with configurable tools, prompts, and transports
- Interactive terminal UI for chat and configuration

## Requirements

- [Node.js](https://nodejs.org) `>= 24`
- npm for package installs and JavaScript tooling
- Provider credentials or local model runtime depending on the LLM you choose

## Usage

Fastest way to get started without cloning the repo:

```bash
npx hoomanjs

# or install globally
npm i -g hoomanjs
```

Or with Bun:

```bash
bunx hoomanjs
```

Recommended first run:

1. Start chatting with `hooman` (same as `hooman chat`).
2. Run `/config` in chat to choose your LLM provider and model, and to manage MCP servers and skills.
3. Use `hooman exec "your prompt"` for one-off tasks.

## Must have

For the best experience, set up both:

1. **MCP servers** for on-demand tools in `chat` / `exec` (task APIs, messaging, schedulers, etc.).
2. **MCP channels** for event-driven automation with `hooman daemon` (notifications become agent prompts).

Suggested MCP servers from this ecosystem:

- [`cronmcp`](https://github.com/vaibhavpandeyvpz/cronmcp) - lets Hooman schedule recurring prompts and automations, so routine checks and follow-ups run on time.
- [`jiraxmcp`](https://github.com/vaibhavpandeyvpz/jiraxmcp) - gives Hooman direct Jira Cloud access to search issues, update tickets, and help drive sprint workflows.
- [`slackxmcp`](https://github.com/vaibhavpandeyvpz/slackxmcp) - connects Hooman to Slack so it can read channel context, draft updates, and post actions where your team already works.
- [`tgfmcp`](https://github.com/vaibhavpandeyvpz/tgfmcp) - enables Telegram bot workflows, making it easy to route notifications and respond from agent-driven chats.
- [`wappmcp`](https://github.com/vaibhavpandeyvpz/wappmcp) - brings WhatsApp Web messaging into Hooman for customer or team communication automations.

For production deployments, still review permissions and use least-privilege credentials/tokens for each integration.

## Install

```bash
npm install
```

Run locally:

```bash
npm run dev -- --help
```

Or use the dev alias:

```bash
npm run build
node dist/cli.js --help
```

Link the CLI locally:

```bash
npm link
hooman --help
```

## Commands

### `hooman exec`

Run a single prompt once.

```bash
hooman exec "Summarize the current repository"
```

Use a specific session id:

```bash
hooman exec "What changed?" --session my-session
```

Skip interactive tool approval (allows every tool call; use only when you trust the prompt and environment):

```bash
hooman exec "Summarize this repo" --yolo
```

Start in **ask** mode (narrower tool surface, no plan lifecycle tools; see [Session mode](#session-mode)):

```bash
hooman exec "Map the architecture" --mode ask
```

### `hooman chat`

Start an interactive stateful chat session.

```bash
hooman
```

Equivalent explicit form:

```bash
hooman chat
```

Optional initial prompt:

```bash
hooman chat "Help me prioritize the next task"
```

Resume or pin a session id:

```bash
hooman chat --session my-session
```

Skip the in-chat tool approval UI (same semantics as `exec --yolo`):

```bash
hooman chat --yolo
```

Start in ask mode:

```bash
hooman chat --mode ask
```

The status bar under the composer shows the active model, effort, mode, and yolo state; a usage row with `context: N% (used/size)`, cumulative `tokens` (`in`/`cin`/`out`), and session `cost: $…` (each segment appears once it has data — context and cost require resolvable billing metadata, see the [`billing` block](#provider-notes)); and an mcp/tools/skills row with a live `elapsed` timer while a turn runs.

### Chat commands

Inside an interactive `chat` session, type `/` to discover slash commands:

- `/model` - pick or set the chat model for this session.
- `/effort` - pick or set the reasoning effort for the active model's provider (`off`, `minimal`, `low`, `medium`, `high`); Shift+Tab cycles it.
- `/mode` - switch the session mode (`agent`, `ask`, `plan`); see [Session mode](#session-mode).
- `/yolo` - toggle auto-approve of tool calls (`on` / `off`).
- `/init` - generate or refresh `AGENTS.md` for the current project.
- `/compact` - compact the conversation history now and persist the result.
- `/new` - start a fresh chat session.
- `/sessions` - browse and resume saved sessions.
- `/config` - launch the configuration workflow (see below).

### Session mode

`exec`, `chat`, and `daemon` accept **`-m` / `--mode`** with:

- **`agent`** (default): normal tool surface and approvals.
- **`plan`**: planning workflow with a reduced tool surface plus `enter_plan_mode` / `exit_plan_mode`.
- **`ask`**: read-oriented, narrower surface (similar to interactive **plan** mode) but **without** `enter_plan_mode` / `exit_plan_mode`.

In **`chat`**, `/mode` can switch between **agent**, **ask**, and **plan**. **ACP** sessions can set `hooman.sessionMode` to `agent`, `plan`, or `ask`.

### `hooman daemon`

Run a long-lived daemon that **always** subscribes to MCP servers advertising the `hooman/channel` capability and feeds each received notification into the agent as a queued prompt.

```bash
hooman daemon
```

Resume or pin a session id:

```bash
hooman daemon --session my-daemon
```

Skip remote channel permission relay and allow every tool call from daemon turns (same risk profile as `exec` / `chat` with `--yolo`):

```bash
hooman daemon --yolo
```

Optional `--mode ask` matches `exec` / `chat` (narrow surface without plan lifecycle tools).

Log raw notification payloads:

```bash
hooman daemon --debug
```

### `hooman config`

Print the effective runtime `config.json` for the current working directory in
the same shape as `config.json`, with credential-like values redacted.

```bash
hooman config
```

### Feature Flags

Runtime tool and prompt switches are controlled from `config.json`:

- `search.enabled`
- `search.provider` (`brave`, `exa`, `firecrawl`, `serper`, or `tavily`)
- `search.brave.apiKey`
- `search.exa.apiKey`
- `search.firecrawl.apiKey`
- `search.serper.apiKey`
- `search.tavily.apiKey`
- `prompts.behaviour`
- `prompts.communication`
- `prompts.execution`
- `prompts.guardrails`
- `tools.todo.enabled`
- `tools.fetch.enabled`
- `tools.filesystem.enabled`
- `tools.shell.enabled`
- `tools.sleep.enabled`
- `tools.subagents.enabled` (enables built-in subagent tools)

### `/config`

The interactive configuration workflow is launched from inside a `chat` session with the `/config` slash command (there is no separate top-level `configure` command). It takes over the terminal on the alternate screen buffer while open, and restores the chat session on exit. Any config changes are picked up when the session re-bootstraps.

```text
/config
```

The configuration UI currently lets you:

- manage general settings such as name, prompts, tools, and compaction
- manage models and providers with field-by-field editors
- choose search provider and set its API key
- toggle bundled harness prompts (`behaviour`, `communication`, `execution`, `guardrails`)
- edit `instructions.md` in your `$VISUAL` / `$EDITOR` (cross-platform fallback included)
- add, edit, and delete MCP servers with field-by-field editors and confirmation
- search, install, refresh, and remove skills

### `hooman acp`

Run Hooman as an Agent Client Protocol (ACP) agent over stdio.

```bash
hooman acp
```

ACP notes:

- ACP session metadata is indexed in the active project's `sessions/acp/sessions.jsonl`; conversation history lives in the regular per-session snapshots (see [Configuration Layout](#configuration-layout))
- ACP loads MCP servers passed on `session/new` and `session/load`, in addition to Hooman's local `mcp.json`
- ACP `session/new` and `session/load` support `_meta.userId`
- session configuration includes `hooman.sessionMode` (`agent`, `plan`, or `ask`); see [Session mode](#session-mode)
- each turn ends with a `usage_update` carrying context-window utilization (`used`/`size`), cumulative session `cost`, and cumulative token totals under `_meta["hoomanjs/tokens"]` — `size` and `cost` come from the model's [`billing` metadata](#provider-notes) (models.dev-backed) and are omitted (`size: 0`, no `cost`) when unresolved; a model switch pushes a fresh `usage_update` so clients can rescale immediately

## VS Code Extension

`src/vscode/` ships a self-contained VS Code extension (`hooman-vscode`) that bridges `hooman acp` into the editor with a **Hooman chat panel** — its own webview view in the activity bar with streaming markdown, collapsible thinking, tool-call cards, plan checklists, usage, session list/load, mode/model/effort pickers, slash-command autocomplete, and inline permission prompts. Works in **stable VS Code, Insiders, and compatible forks** — no proposed APIs and no special subscription required.

It's not published to the marketplace yet. Quick start:

```bash
# from the repo root
npm install && npm run build && npm link

# from src/vscode
cd src/vscode
npm install && npm run compile
code .          # open src/vscode as its own workspace, then press F5
```

Or package and install a `.vsix` into any VS Code-compatible editor: `npm run package` in `src/vscode`, then `code --install-extension hooman-vscode-<version>.vsix`.

Full setup, settings, and architecture notes: [`src/vscode/README.md`](src/vscode/README.md).

## Configuration Layout

Hooman stores its data in:

```text
~/.hooman/
```

Important files and folders:

- `config.json` - app name, reusable provider configs, model configs, tool flags, and compaction
- `instructions.md` - system instructions used to build the agent prompt
- `mcp.json` - MCP server definitions
- `skills/` - installed skills
- `bin/` - runtime-managed helper binaries (including bootstrapped `rg` for the `grep` tool when system `rg` is unavailable)
- `cache/` - runtime caches used by tools and subsystems
- `projects.json` - registry mapping each project root to a stable UUID
- `projects/<uuid>/` - per-project storage, scoped to the project (git root, falling back to cwd) the session runs in:
  - `sessions/` - persisted session data (per-session snapshots and the ACP session index at `sessions/acp/sessions.jsonl`)
  - `offloaded-content/` - offloaded tool output (large tool results retrievable via `retrieve_offloaded_content`)
  - `memory/` - durable extracted memory store
  - `attachments/` - saved attachments (e.g. clipboard images)
  - `plans/` - plan-mode markdown documents

### Project-scoped storage

`sessions`, `memory`, `attachments`, and `plans` are scoped per project rather than shared globally. On first use in a working directory, Hooman resolves the project root (the nearest git root, falling back to the cwd), mints a UUID for it, and records the mapping in `~/.hooman/projects.json`. All four folders then live under `~/.hooman/projects/<uuid>/`, so unrelated projects never see each other's sessions, memory, attachments, or plans. Config and MCP resolution are unaffected (see repo-local overlays below).

### Repo-local runtime overlays

At runtime, Hooman resolves configuration in this order:

1. `~/.hooman/config.json` and `~/.hooman/mcp.json`
2. `<git-root>/.hooman/config.json` and `<git-root>/.hooman/mcp.json` (if present)
3. matching `.hooman/config.json` and `.hooman/mcp.json` files in nested directories from git root to current working directory

Nearest files win when keys overlap.

For app config (`config.json`):

- plain objects are deep-merged
- scalar values are overridden by the nearest file
- `providers` and `llms` are merged by `name` (nearest entry with the same name replaces inherited entries)

For MCP config (`mcp.json`):

- `mcpServers` is merged by server name (nearest entry with the same name wins)

Notes:

- Runtime overlays apply to `chat`, `exec`, `daemon`, and `acp` bootstraps.
- `hooman config` prints only the merged effective `config.json` shape with credential-like values redacted.
- The `/config` UI and `hooman mcp auth/logout/auth-status` still target home config (`~/.hooman/*`) directly.
- Keep secrets in home config unless you explicitly want project-scoped credentials.

`grep` tool binary resolution order:

1. Use system `rg` when available.
2. Else use cached `~/.hooman/bin/rg` (or `rg.exe` on Windows).
3. Else download and verify a platform-specific ripgrep release into `~/.hooman/bin/`.

## Example `config.json`

The on-disk shape uses a reusable **`providers`** array plus a non-empty **`llms`** array. Each provider stores a runtime `provider` id plus provider-specific `options`; each LLM references a provider by name, stores its model `options`, and marks one entry as the default. The bundled **hooman-config** skill documents the full schema.

```json
{
  "name": "Hooman",
  "providers": [
    {
      "name": "Ollama",
      "provider": "ollama",
      "options": {}
    }
  ],
  "llms": [
    {
      "name": "Default",
      "provider": "Ollama",
      "options": {
        "model": "gemma4:e4b"
      },
      "default": true
    }
  ],
  "search": {
    "enabled": false,
    "provider": "brave",
    "brave": {},
    "exa": {},
    "firecrawl": {},
    "serper": {},
    "tavily": {}
  },
  "prompts": {
    "behaviour": true,
    "communication": true,
    "execution": true,
    "guardrails": true
  },
  "tools": {
    "todo": { "enabled": true },
    "fetch": { "enabled": true },
    "filesystem": { "enabled": true },
    "shell": { "enabled": true },
    "sleep": { "enabled": true },
    "subagents": { "enabled": true }
  },
  "compaction": {
    "ratio": 0.75,
    "keep": 5
  }
}
```

Tool approvals are session-scoped and are not persisted in `config.json`.

Hooman enables Strands `ContextOffloader` by default with file-backed storage under the project-scoped `~/.hooman/projects/<uuid>/offloaded-content`, so large tool results can be previewed in-context and retrieved later without bloating the active conversation window.

Supported `providers[].provider` values registered in this release (see `src/core/models/index.ts`):

- `anthropic`
- `azure`
- `bedrock`
- `google`
- `groq`
- `minimax`
- `moonshot`
- `ollama`
- `openai`
- `openrouter`
- `xai`

Supported `search.provider` values:

- `brave`
- `exa`
- `firecrawl`
- `serper`
- `tavily`

## Provider Notes

Provider entries now look like:

```json
{
  "name": "MiniMax",
  "provider": "minimax",
  "options": {
    "apiKey": "..."
  }
}
```

LLM entries reference a provider by name and carry normalized model options:

```json
{
  "name": "MiniMax M3",
  "provider": "MiniMax",
  "options": {
    "model": "MiniMax-M3",
    "temperature": 1,
    "maxTokens": 4096
  },
  "default": true
}
```

Supported provider option fields:

All reasoning-capable providers share a common optional `reasoning` object (`{ effort?, summary?, display? }`). `effort` is `"minimal" | "low" | "medium" | "high"` and its presence enables thinking; Hooman translates it to each backend's native shape. `summary` (`"auto" | "concise" | "detailed" | "none"`) is only honored by the OpenAI/Azure Responses API. `display` (`"summarized" | "omitted"`) applies to Bedrock Claude / MiniMax only. See the bundled **hooman-config** skill for the exact per-provider mapping.

- `anthropic`: `apiKey`, optional `baseURL`, optional `headers`, optional `reasoning`
- `azure`: optional `resourceName`, optional `baseURL`, optional `apiKey`, optional `headers`, optional `apiVersion`, optional `useDeploymentBasedUrls`, optional `reasoning`
- `bedrock`: `region`, `accessKeyId`, `secretAccessKey`, optional `sessionToken`, optional `apiKey`, optional `reasoning`
- `google`: `apiKey`, optional `reasoning`
- `groq`: `apiKey`, optional `baseURL`, optional `headers`, optional `reasoning`
- `minimax`: `apiKey`, optional `headers`, optional `reasoning`
- `moonshot`: `apiKey`, optional `baseURL`, optional `headers`, optional `reasoning`
- `ollama`: optional `baseURL`, optional `reasoning`
- `openai`: `apiKey`, optional `baseURL`, optional `headers`, optional `api` (`"responses"` (default) or `"chat"`), optional `reasoning`
- `openrouter`: `apiKey`, optional `baseURL`, optional `headers`, optional `reasoning`
- `xai`: `apiKey`, optional `baseURL`, optional `headers`, optional `reasoning`

Normalized LLM option fields:

- `model`
- optional `temperature`
- optional `maxTokens`

Each LLM entry may also carry an optional **`billing`** block used to display context-window utilization and cumulative session cost (in the chat TUI status bar and the VS Code extension footer, and sent to ACP clients via `usage_update`):

```json
{
  "name": "Haiku 4.5",
  "provider": "LiteLLM Anthropic",
  "billing": {
    "name": "claude-haiku-4.5",
    "context": 200000,
    "costs": { "input/m": 1, "cache/m": 0.1, "output/m": 5 }
  },
  "options": { "model": "claude-haiku-4.5" },
  "default": true
}
```

`billing.name` is required when the block is present and is the identifier looked up in the [models.dev](https://models.dev) catalog (cached under `~/.hooman/cache/` and refreshed at most once daily); when `billing` is omitted, `options.model` is used as the lookup name. `context` (window size in tokens) and `costs` (USD per million tokens; `"cache/m"` prices cached-input reads) override whatever models.dev resolves. If neither the config nor models.dev yields the data, context usage and cost are simply not shown.

Notes:

- Google maps normalized `maxTokens` to the SDK's `maxOutputTokens` internally.
- Azure uses the Vercel AI SDK `@ai-sdk/azure` provider. Set the LLM `model` to your Azure deployment name, not the raw OpenAI model id.
- Ollama maps normalized `temperature` into Ollama `options.temperature`.
- MiniMax uses the Anthropic-compatible endpoint `https://api.minimax.io/anthropic` automatically.
- Moonshot defaults `baseURL` to `https://api.moonshot.ai/v1` when it is omitted. It is served through the reasoning-aware openai-compatible adapter, so Kimi's `reasoning_content` streams as thinking — this makes it the right provider for reaching Kimi through an OpenAI-compatible proxy (e.g. LiteLLM), where the `openai` provider's Chat adapter would drop reasoning.
- OpenRouter defaults `baseURL` to `https://openrouter.ai/api/v1` when it is omitted, and model names are usually provider-qualified ids such as `anthropic/claude-3.5-sonnet`. It also uses the openai-compatible adapter, so reasoning streams for reasoning models.
- The `openai` provider defaults to the Responses API (`api: "responses"`), which surfaces reasoning. `api: "chat"` does NOT surface reasoning (the Chat adapter drops `reasoning_content`); route such proxies through `moonshot`/`openrouter` instead.
- `reasoning.display` is for Bedrock Claude (Opus 4.7+ hide reasoning by default) and MiniMax; the native Anthropic API rejects it.
- Bedrock can rely on the AWS default credential chain when explicit credentials are not provided.

## MCP Configuration

Detailed design notes for planned OAuth-enabled remote MCP support live in [docs/mcp-oauth-design.md](docs/mcp-oauth-design.md).

`mcp.json` is stored as:

```json
{
  "mcpServers": {}
}
```

At runtime, project-local `.hooman/mcp.json` files are merged on top of `~/.hooman/mcp.json` from git root to current directory. On name conflicts, the nearest `mcpServers.<name>` entry wins.

### Example stdio server

```json
{
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "env": {
        "EXAMPLE": "1"
      },
      "cwd": "/tmp"
    }
  }
}
```

### Example streamable HTTP server

```json
{
  "mcpServers": {
    "remote": {
      "type": "streamable-http",
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer token"
      }
    }
  }
}
```

### Example OAuth-capable remote server

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

1. **Pre-registered client** — if `oauth.clientId` (and optionally `clientSecret`) is set, it is used as-is and no registration happens.
2. **Dynamic Client Registration (DCR)** — if the auth server advertises a `registration_endpoint`, Hooman registers a client on the fly. The redirect URI it registers is reused on later authorizations (persisted in `~/.hooman/mcp-oauth.json`), so keep it stable — set `oauth.callbackPort` or `oauth.redirectUri` if a server pins the redirect.
3. **Client ID Metadata Document (CIMD / SEP-991)** — some servers (e.g. Slack) support neither a static client nor DCR, and instead advertise `client_id_metadata_document_supported: true`. For these, the client presents an HTTPS URL that hosts a JSON metadata document; that URL becomes the `client_id`. Hooman sends `oauth.clientMetadataUrl` (falling back to a bundled default) whenever the server supports it.

If a server supports none of these, authorization fails with `Incompatible auth server: does not support dynamic client registration` — supply a `clientId` or `clientMetadataUrl`.

### Hosting a CIMD document (GitHub Pages)

The metadata document is a static JSON file served over HTTPS. A copy ships in this repo at [`docs/oauth/client-metadata.json`](docs/oauth/client-metadata.json) and is published via GitHub Pages at `https://vaibhavpandey.com/hooman/oauth/client-metadata.json`, which is the default `clientMetadataUrl`.

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

### Example SSE server

```json
{
  "mcpServers": {
    "legacy": {
      "type": "sse",
      "url": "https://example.com/sse",
      "headers": {
        "Authorization": "Bearer token"
      }
    }
  }
}
```

## MCP Notes

- MCP server `instructions` from the protocol `initialize` response are appended to Hooman's system prompt, after local `instructions.md` and session-specific prompt overrides.
- Hooman reads these instructions automatically from connected MCP servers when building the agent.
- Remote MCP OAuth helpers are available via:
  - `hooman mcp auth <server>`
  - `hooman mcp logout <server>`
  - `hooman mcp auth-status`
- `hooman daemon` subscribes to MCP servers that advertise the experimental `hooman/channel` capability (always on; there is no opt-out flag).
- Hooman also reads `hooman/user`, `hooman/session`, and `hooman/thread` capability paths so daemon turns preserve origin metadata from the source channel.
- When a matching notification is received, Hooman uses `params.content` as the prompt if it is a string; otherwise it JSON-stringifies the notification params and sends that to the agent.
- Daemon mode processes notifications sequentially and reuses the same agent session over time.
- Tool calls from daemon turns are no longer blanket auto-approved: if the originating MCP server supports `hooman/channel/permission`, Hooman relays a remote approval request back to that source; otherwise the tool call is denied.
- `exec`, `chat`, and `daemon` accept `--yolo` to bypass those approval paths and allow all tools without prompting or relay.

## Skills

Skills are installed under:

```text
~/.hooman/skills
```

At runtime, Hooman uses the Strands `AgentSkills` plugin to load:

- bundled built-in skills shipped with Hooman
- user-installed skills under `~/.hooman/skills`

The local skills folder is treated as a parent directory of skill subdirectories, where each installed skill should live in its own folder containing `SKILL.md`.

When a session starts, the plugin injects available skill metadata into the system prompt and exposes the `skills` tool so the model can activate a skill and load its full instructions on demand.

The `/config` workflow can:

- search the public skills catalog
- install a skill from a source string, repo, URL, or local path
- refresh installed skills
- remove installed skills with confirmation

## Development

Install dependencies:

```bash
npm install
```

Run the CLI:

```bash
npm run dev -- --help
```

Run typecheck:

```bash
npm run typecheck
```

Build the project:

```bash
npm run build
```

After making any code change, run both verification steps:

```bash
npm run typecheck
npm run build
```

## License

MIT. See `LICENSE`.
