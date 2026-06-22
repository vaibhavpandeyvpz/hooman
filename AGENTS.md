# Hooman — AI agent toolkit

Hooman is a hackable, local-first AI agent toolkit written in TypeScript. It ships as a Node.js CLI and library, built on the [Strands Agents SDK](https://www.npmjs.com/package/@strands-agents/sdk) and [Ink](https://github.com/vadimdemedes/ink) for terminal UI.

- **Package name:** `hoomanjs`
- **Runtime:** Node.js `>= 24` (see `.nvmrc`)
- **Module system:** ES modules (`"type": "module"`)
- **License:** MIT

## Repository layout

| Path                                | Purpose                                                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `src/cli.ts`                        | CLI entrypoint (Commander + Ink). Compiles to `dist/cli.js`, exposed as the `hooman` bin.                                           |
| `src/index.ts`                      | Public library API exported by the npm package.                                                                                     |
| `src/core/`                         | Core configuration, memory, state, context, and skills registry.                                                                    |
| `src/core/agent/`                   | Agent bootstrap and invocation loop.                                                                                                |
| `src/core/tools/`                   | Built-in tool definitions (filesystem, shell, web_search, fetch, etc.).                                                             |
| `src/core/modes/`                   | Session mode logic (`agent`, `ask`, `plan`).                                                                                        |
| `src/core/mcp/`                     | MCP client configuration, connection, OAuth auth, and tool bridging.                                                                |
| `src/core/approvals/`               | Tool-call approval system for `exec`, `chat`, and `daemon`.                                                                         |
| `src/core/subagents/`               | Subagent orchestration utilities.                                                                                                   |
| `src/core/utils/`                   | Shared helpers and path normalization.                                                                                              |
| `src/core/prompts/`                 | Static Markdown prompts, harness prompts, session-mode prompts, agent prompts.                                                      |
| `src/core/skills/built-in/`         | Built-in skills shipped with the package (e.g. `hooman-coding`, `hooman-config`, `hooman-mcp`, `hooman-channels`, `hooman-skills`). |
| `src/chat/`                         | Interactive `chat` TUI (Ink/React components).                                                                                      |
| `src/configure/`                    | Ink-based configuration workflow.                                                                                                   |
| `src/exec/`                         | One-shot `exec` command approval handling.                                                                                          |
| `src/daemon/`                       | MCP channel-driven `daemon` command.                                                                                                |
| `src/acp/`                          | Agent Client Protocol (ACP) stdio server.                                                                                           |
| `scripts/copy-bundled-assets.mjs`   | Post-build step that copies Markdown skill/prompt assets into `dist/`.                                                              |
| `reference/`                        | Vendored reference code from other agent projects. **Not source code** — do not edit as part of feature work.                       |
| `.github/workflows/publish-npm.yml` | CI that installs, builds, and publishes to npm on version tags.                                                                     |

## Build and run commands

Install dependencies:

```bash
npm install
```

Run the CLI in development (uses `tsx`):

```bash
npm run dev -- --help
npm run dev -- exec "your prompt"
npm run dev -- chat
```

Build for release:

```bash
npm run build        # tsc + copy bundled assets to dist/
npm run start        # node dist/cli.js
```

Other useful scripts:

```bash
npm run typecheck    # tsc --noEmit
npm run clean        # rm -rf dist
npm link             # link `hooman` CLI locally
```

## Testing and verification

- **There is no test framework configured in this repository.** `package.json` has no `test` script and there are no `.test.*` files.
- Verification is currently manual/build-based:
  - `npm run typecheck` — strict TypeScript check.
  - `npm run build` — must compile without errors and copy assets.
  - Smoke-test the built CLI: `node dist/cli.js --help`.

## CLI commands

Default invocation opens interactive chat:

```bash
hooman
hooman chat
```

Other top-level commands:

```bash
hooman exec "prompt"                    # one-shot prompt
hooman daemon                           # long-lived MCP channel listener
hooman acp                              # ACP agent over stdio
hooman mcp auth <server>                # OAuth login for a configured MCP server
hooman mcp logout <server>              # Clear stored OAuth credentials
hooman mcp logout <server> --scope all  # Scope: all, client, tokens, discovery
hooman mcp auth-status                  # Show MCP server auth status
```

There is no top-level `configure` command. The configuration TUI is launched from inside a `chat` session via the `/config` slash command (see in-chat commands below).

Common flags on `exec`, `chat`, and `daemon`:

- `-s, --session <id>` — pin or resume a session id.
- `-m, --mode <agent|ask|plan>` — tool surface mode. `agent` is the full default surface; `ask` is read-oriented and omits plan-lifecycle tools; `plan` is the plan-file workflow.
- `--yolo` — auto-approve all tool calls.
- `--debug` (daemon only) — log raw MCP channel payloads.

In-chat slash commands (interactive `chat`): `/model`, `/mode`, `/yolo`, `/init`, `/compact` (compact history now), `/new` (start a fresh session), and `/config` (launch the configuration TUI on the alternate screen, restoring chat on exit).

## Configuration layout

Hooman stores user data under `~/.hooman/`:

- `config.json` — app name, named providers, LLM configs, tool toggles, compaction settings.
- `instructions.md` — custom system instructions appended to the agent prompt.
- `mcp.json` — configured MCP servers (`stdio`, `streamable-http`, `sse`).
- `mcp-oauth.json` — stored OAuth credentials for remote MCP servers.
- `skills/` — installed skills (Markdown `SKILL.md` files in subdirectories).
- `sessions/` — persisted session data.
- `acp-sessions/` — persisted ACP session metadata.

Default `config.json` uses a local Ollama provider and `gemma4:e4b` as the default model. Supported providers include `anthropic`, `bedrock`, `google`, `groq`, `moonshot`, `ollama`, `openai`, and `xai`. See `src/core/models/index.ts` for the currently wired providers and `src/core/config.ts` for the JSON schema.

## Code style and conventions

- **Language:** TypeScript with strict mode enabled (`tsconfig.json`).
- **Module resolution:** `NodeNext`; imports use `.js` extensions even for `.ts`/`.tsx` source files.
- **React/JSX:** `jsx: "react-jsx"` (Ink components use React 19).
- **Formatting/Linting:** No ESLint or Prettier config is present. Follow existing formatting and keep changes narrow.
- **File naming:** kebab-case for modules (`acp-agent.ts`, `tool-approvals.ts`).
- **Imports:** prefer explicit named imports; internal imports always include the `.js` extension.
- **State:** session-scoped agent state is stored on the Strands `appState` object; see `src/core/state/`.
- **Prompts:** static prompts are Markdown files loaded at runtime; bundled assets are copied to `dist/` by the post-build script.
- **Skills:** each skill is a folder containing a `SKILL.md` with YAML frontmatter. The built-in skills live under `src/core/skills/built-in/` and are packaged into `dist/`.

## Security and operational notes

- **Tool approvals:** by default the agent asks for approval before destructive tools (`shell`, `filesystem` writes, etc.). `--yolo` disables this; use only in trusted environments.
- **Credentials:** API keys and OAuth tokens live in `~/.hooman/config.json` and `~/.hooman/mcp-oauth.json`. Do not commit these files or paste secrets into source code.
- **Path safety:** filesystem tools normalize user paths and reject traversal outside the working directory; see `src/core/utils/normalize-user-path.ts`.
- **MCP OAuth:** remote MCP servers may trigger an OAuth flow that starts a local callback server. Review server configs in `mcp.json` before authenticating.
- **Daemon mode:** processes MCP channel notifications as queued prompts; use `--yolo` only when the channel source and tools are trusted.

## Release workflow

Publishing is handled by `.github/workflows/publish-npm.yml`:

- Triggers on pushes to `main`, tags matching `v*`, and manual dispatch.
- Runs `npm ci` and `npm run build`.
- Publishes to npm with provenance only when the ref is a `refs/tags/v*` tag.

Bump the version in `package.json` and push a matching Git tag to release.
