# Hooman — AI agent toolkit

Hooman is a hackable, local-first AI agent toolkit written in TypeScript. It ships as a Node.js CLI and library, built on the [Strands Agents SDK](https://www.npmjs.com/package/@strands-agents/sdk) and [Ink](https://github.com/vadimdemedes/ink) for terminal UI.

- **Package name:** `hoomanjs`
- **Runtime:** Node.js `>= 24` (see `.nvmrc`)
- **Module system:** ES modules (`"type": "module"`)
- **License:** MIT

## Repository layout

| Path                                  | Purpose                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/cli.ts`                          | CLI entrypoint (Commander + Ink). Compiles to `dist/cli.js`, exposed as the `hooman` bin.                                                                                                                                                                                                                                                              |
| `src/index.ts`                        | Public library API exported by the npm package.                                                                                                                                                                                                                                                                                                        |
| `src/core/`                           | Core configuration, memory, state, context, and skills registry.                                                                                                                                                                                                                                                                                       |
| `src/core/agent/`                     | Agent bootstrap and invocation loop.                                                                                                                                                                                                                                                                                                                   |
| `src/core/tools/`                     | Built-in tool definitions (filesystem, shell, web_search, fetch, etc.).                                                                                                                                                                                                                                                                                |
| `src/core/modes/`                     | Session mode logic (`agent`, `ask`, `plan`).                                                                                                                                                                                                                                                                                                           |
| `src/core/mcp/`                       | MCP client configuration, connection, OAuth auth, and tool bridging.                                                                                                                                                                                                                                                                                   |
| `src/core/approvals/`                 | Tool-call approval system for `exec`, `chat`, and `daemon`.                                                                                                                                                                                                                                                                                            |
| `src/core/subagents/`                 | Subagent orchestration utilities.                                                                                                                                                                                                                                                                                                                      |
| `src/core/utils/`                     | Shared helpers and path normalization.                                                                                                                                                                                                                                                                                                                 |
| `src/core/prompts/`                   | Static Markdown prompts, harness prompts, session-mode prompts, agent prompts.                                                                                                                                                                                                                                                                         |
| `src/core/skills/built-in/`           | Built-in skills shipped with the package (e.g. `hooman-coding`, `hooman-config`, `hooman-mcp`, `hooman-channels`, `hooman-skills`).                                                                                                                                                                                                                    |
| `src/chat/`                           | Interactive `chat` TUI (Ink/React components).                                                                                                                                                                                                                                                                                                         |
| `src/configure/`                      | Ink-based configuration workflow.                                                                                                                                                                                                                                                                                                                      |
| `src/exec/`                           | One-shot `exec` command approval handling.                                                                                                                                                                                                                                                                                                             |
| `src/daemon/`                         | MCP channel-driven `daemon` command.                                                                                                                                                                                                                                                                                                                   |
| `src/acp/`                            | Agent Client Protocol (ACP) stdio server.                                                                                                                                                                                                                                                                                                              |
| `src/vscode/`                         | Self-contained VS Code extension sub-package (native chat backed by `hooman acp`). Own `package.json`/`tsconfig.json`; excluded from the root build. See [`src/vscode/README.md`](src/vscode/README.md).                                                                                                                                               |
| `docs/`                               | Self-contained Astro + Starlight sub-package: the product site (custom landing page) plus the full documentation, deployed to GitHub Pages at `https://vaibhavpandey.com/hooman/`. Own `package.json`; excluded from the root build. `docs/public/oauth/client-metadata.json` is the published MCP OAuth CIMD document (see the MCP OAuth note below). |
| `scripts/copy-bundled-assets.mjs`     | Post-build step that copies Markdown skill/prompt assets into `dist/`.                                                                                                                                                                                                                                                                                 |
| `reference/`                          | Vendored reference code from other agent projects. **Not source code** — do not edit as part of feature work.                                                                                                                                                                                                                                          |
| `.github/workflows/publish-npm.yml`   | CI that installs, builds, and publishes to npm on version tags.                                                                                                                                                                                                                                                                                        |
| `.github/workflows/publish-pages.yml` | CI that builds `docs/` and deploys it to GitHub Pages on pushes to `main` touching `docs/**`.                                                                                                                                                                                                                                                          |

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

After making any code change, run both:

```bash
npm run typecheck
npm run build
```

## VS Code extension (`src/vscode/`)

`src/vscode/` is a self-contained sub-package, not part of the `hoomanjs` npm package. The `hooman-vscode` extension bridges `hooman acp` into the editor via a single chat surface:

- **Webview chat panel:** an activity-bar webview view (`chat-view.ts` serving a `webview/` SolidJS app, styled with Tailwind CSS v4 and lucide-solid icons, bundled by Vite into `media/chat.js`/`chat.css`) with streaming markdown, collapsible thinking with a "thought for Xs · ~N tokens" summary, a busy/thinking status strip with elapsed timer, tool-call cards, pinned plan checklist, pinned Changes panel (per-file diff/keep/undo backed by `edit-tracker.ts` baselines), a token-usage footer (per-turn `in`/`cin`/`out` token totals for the latest request, mirroring the CLI's meter — the context gauge covers overall window usage; both meters normalize per-request usage via `src/core/models/usage.ts` so providers that report input inclusive of cache reads — OpenAI and the Vercel-backed factories — don't double-count cached tokens against Anthropic-style additive reporting; plus a context-window gauge and cumulative session cost fed by the ACP `usage_update`'s `used`/`size`/`cost`, shown only when the agent resolved the model's billing metadata — see the billing section below), session quick-pick (list/load), pill-style config-option pickers (mode/model/effort, each with icon + accent color), slash-command autocomplete, and inline permission cards. Works in stable VS Code, Insiders, and compatible forks — no proposed APIs, no special entitlement required.

Key facts:

- **Isolation:** own `package.json`, `tsconfig.json`, and `node_modules`; the root `tsconfig.json` excludes `src/vscode/**` and the root `npm run build`/`typecheck` never touch it. Build/typecheck it from within `src/vscode/` (`npm run compile` runs `tsc` for the extension host, then `vite build` for the webview app; the webview has its own `tsconfig.webview.json` with `jsxImportSource: solid-js`, and shares bridge-protocol types with the host via `src/shared/protocol.ts`).
- **Shared ACP layer:** `acp-client.ts` spawns `hooman acp` (one process for the extension lifetime; sessions multiplex over it), `fs-backend.ts`/`terminal-backend.ts` implement the ACP client-side `fs/*`/`terminal/*` capabilities (which the agent's built-in filesystem/shell tools route through when advertised), `edit-tracker.ts` snapshots pre-write baselines for the Changes panel (native diff, keep/undo), and `permissions.ts` resolves `session/request_permission` (inline panel card → modal fallback). `chat-view.ts` sends `_meta["hoomanjs/vscode"]: true` on `session/new`/`session/load` so the agent loads the local MCP config (`~/.hooman/mcp.json` + repo overlays) as usual instead of the default ACP session-scoped-only isolation; config picks made before the eager session exists are buffered and applied once it does. Session history is a custom-rendered `Sessions` overlay inside the webview (`webview/components/SessionsPanel.tsx`, toggled by the title-bar history button / `hooman.pickSession`): saved sessions grouped by day with search, the ongoing one marked (spinner while a turn runs), click-to-open, per-row delete (`session/delete`, host-side modal confirm), and a New Chat action. The host pushes list refreshes over the bridge (`sessions`/`showSessions` outbound, `listSessions`/`sessionsClosed`/`openSession`/`deleteSession`/`newChat` inbound) while the overlay is open, and switching sessions frees the previous one's in-memory state via `session/close`.
- **Config:** `hooman.acp.command` (default `npx`) / `hooman.acp.args` (default `["hoomanjs", "acp"]`) VS Code settings control how the agent process is spawned — the default resolves `hoomanjs` via `npx` with no setup required; point them at an absolute path (or a linked/built `hooman`) to bypass `npx`.
- **Packaging:** `npm run package` produces a `.vsix`. The webview app (SolidJS, Tailwind, lucide-solid, marked) is fully bundled into `media/chat.js`/`chat.css` by Vite, and the extension host (`src/*.ts`) is bundled into a single `out/extension.js` by esbuild (`esbuild.mjs`, `external: ["vscode"]`) — so the extension host's only real dependency (`@agentclientprotocol/sdk`, plus its `zod` dependency) is inlined at build time and kept a `devDependency`; nothing ships under `node_modules` in the `.vsix` (`.vscodeignore` excludes it outright). `tsc --noEmit` (both `tsconfig.json` and `tsconfig.webview.json`) remains the source of truth for type errors; esbuild only bundles.
- **Marketplace metadata:** `license`/`icon` (`media/icon.png`, rendered from `.github/logo.svg`)/`homepage`/`bugs`/`galleryBanner` are set on `src/vscode/package.json`; `src/vscode/LICENSE` is a copy of the root `LICENSE` (`vsce` looks for one inside the packaged sub-package, not the repo root). `src/vscode/CHANGELOG.md` is rendered as a Marketplace tab and should get an entry per published version.
- **Publishing:** `.github/workflows/publish-vscode.yml` runs `vsce package` (and `vsce publish` using a `VSCE_PAT` secret) from `src/vscode/` on pushes to `main` and on `v*` tags — the same tag namespace as the root package's npm release (`publish-npm.yml`), since both are versioned in lockstep.
- **Full setup, build, and F5 run instructions:** see [`src/vscode/README.md`](src/vscode/README.md).

## Testing and verification

- **There is no test framework configured in this repository.** `package.json` has no `test` script and there are no `.test.*` files.
- Verification is currently manual/build-based:
  - `npm run typecheck` — strict TypeScript check.
  - `npm run build` — must compile without errors and copy assets.
  - Smoke-test the built CLI: `node dist/cli.js --help`.
- For normal code changes, treat `npm run typecheck` and `npm run build` as the default verification pair.

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

In-chat slash commands (interactive `chat`): `/model`, `/effort` (pick/set reasoning effort; Shift+Tab cycles it), `/mode`, `/yolo`, `/init`, `/compact` (compact history now), `/new` (start a fresh session), `/sessions` (browse and resume saved sessions), and `/config` (launch the configuration TUI on the alternate screen, restoring chat on exit).

The chat status bar has three rows: model/effort/mode/yolo; a usage row of `context: N% (used/size) • tokens: … • cost: $…` segments that each stay hidden until they have data (the row collapses when empty); and the mcp/tools/skills row, which appends a live `• elapsed MM:SS` timer while a turn runs.

The `/config` workflow uses menu screens where you select a field and edit just that value. Enum-like values such as the OpenAI API mode and the shared reasoning options (`effort`/`summary`/`display`) use pickers.

## Configuration layout

Hooman stores user data under `~/.hooman/`:

- `config.json` — app name, named providers, LLM configs, tool toggles, compaction settings.
- `instructions.md` — custom system instructions appended to the agent prompt.
- `mcp.json` — configured MCP servers (`stdio`, `streamable-http`, `sse`).
- `mcp-oauth.json` — stored OAuth credentials for remote MCP servers.
- `skills/` — installed skills (Markdown `SKILL.md` files in subdirectories).
- `bin/` — runtime-managed helper binaries (including bootstrapped `rg` for the `grep` tool).
- `cache/` — runtime caches used by tools/subsystems.
- `sessions/` — persisted session data.
- `projects/<project-uuid>/sessions/acp/sessions.jsonl` — ACP session index (project-scoped; see `src/acp/utils/paths.ts` and `src/acp/sessions/store.ts`): an append-only JSONL patch log (last record wins per session id, deletes are tombstones) holding only protocol-facing metadata — `cwd`, title, client user id, session-scoped MCP servers, vscode flag, yolo/mode/model. Conversation history is **not** duplicated there: the Strands `SessionManager` snapshot (`sessions/<session-id>/snapshot_latest.json`, restored during `agent.initialize()` on `session/load`/`resume`, saved on `AfterInvocationEvent`) is the single source of truth for messages. Compaction of the log runs once per `hooman acp` process start; a legacy per-session directory store (`sessions/acp/<id>/{meta.json,messages.json}`) is migrated into the index (with snapshot backfill) on first boot.

Session list titles are AI-generated from the first user prompt by a Strands plugin registered on every agent (`src/core/agent/session-title-plugin.ts`), falling back to the first prompt line on failure. The plugin starts a best-effort side call to the session's current model (`src/core/sessions/generate-title.ts`) when the first real user message lands (`MessageAddedEvent`), then awaits it on `AfterInvocationEvent` (ordered before the session managers' save hooks) and stages the title on `appState` under `hooman.title` — so the turn's own snapshot save persists it into `data.state` in `snapshot_latest.json` (preferred by `listCliSessions`) across chat/exec/daemon with no surface-specific code. ACP sets an echo-derived placeholder title on the first prompt, and passes an `onSessionTitle` callback through the bootstrap meta so the plugin's generated title also patches the ACP session index (`sessions.jsonl`) and pushes a `session_info_update` to the client.

### Repo-local runtime overlays

At runtime, `config.json` and `mcp.json` support project-local overlays that layer on top of the home config. Overlay files live in a nested `.hooman/` directory and are discovered by walking up from the current working directory to the git root:

- Primary: `~/.hooman/config.json` and `~/.hooman/mcp.json` (or `$HOOMAN_HOME/*` when `HOOMAN_HOME` is set).
- Overlays: `.hooman/config.json` and `.hooman/mcp.json` in each directory from the git root down to the current working directory. The nearest file wins on key conflicts.
- App config deep-merges objects and merges `providers`/`llms` by `name`; MCP config merges `mcpServers` by server name.
- Overlays apply to the `chat`, `exec`, `daemon`, and `acp` bootstraps. The `/config` UI and `hooman mcp auth/logout/auth-status` operate on the home config only. See `src/core/runtime-config.ts` and `src/core/utils/discover-files.ts`.
- Exception: in ACP mode MCP servers are session-scoped (supplied by the client on `session/new`/`load`/`resume`) and the local `mcp.json` (home + overlays) is skipped — unless the client identifies as the official VS Code extension via `_meta["hoomanjs/vscode"]: true`, in which case the local MCP config loads as usual on top of any session-scoped servers (see `src/acp/meta/vscode.ts` and `AcpMeta.loadLocalMcpConfig` in `src/core/index.ts`).

`AGENTS.md` instruction files are a separate mechanism and are **not** nested under `.hooman/`: they are discovered as bare `AGENTS.md` files walked from the git root down to the current directory (see `src/core/prompts/runtime.ts`).

Default `config.json` uses the local `llama-cpp` provider with two LLM entries (downloaded from the Hugging Face Hub on first use): `Qwen/Qwen3-1.7B-GGUF:Q8_0` (the default) and `unsloth/gemma-4-E2B-it-GGUF:Q8_0`. Do not switch the Gemma entry to Google's official `google/gemma-4-E2B-it-qat-q4_0-gguf`: that GGUF has a malformed metadata entry (empty key) that llama.cpp's parser rejects with `GGML_ASSERT(!key.empty())`, crashing the process. Supported providers include `anthropic`, `azure`, `bedrock`, `google`, `groq`, `llama-cpp`, `minimax`, `moonshot`, `ollama`, `openai`, `openrouter`, and `xai`. See `src/core/models/index.ts` for the currently wired providers, `src/core/config.ts` for the top-level config schema, and `src/core/models/types.ts` for provider/LLM option schemas. Reasoning-capable providers share a common `reasoning: { effort?, summary?, display? }` option that each factory translates to the backend's native shape. The `minimax` factory is served through the AI SDK Anthropic adapter (`@ai-sdk/anthropic` via the Strands `VercelModel`, default `baseURL` `https://api.minimax.io/anthropic`, overridable) rather than the native Strands `AnthropicModel`, because it reads token usage from the stream's final `message_delta` — MiniMax reports `input_tokens: 0` in `message_start`, which the native model trusts. The `llama-cpp` provider (`src/core/models/llama-cpp/`) runs GGUF models in-process via `node-llama-cpp` through a custom Strands `Model` (like Ollama's); `options.model` is a Hugging Face repo (`owner/repo`, GGUF file auto-detected; `owner/repo:QUANT` picks a quant variant; default `Qwen/Qwen3-1.7B-GGUF:Q8_0`), an exact `owner/repo/file.gguf`, or a local `.gguf` path, downloaded via `@huggingface/hub` (optional `hfToken`, falling back to `HF_TOKEN`) into `~/.hooman/cache/huggingface`; loaded runtimes/weights are shared process-wide, tool calls use node-llama-cpp's chat-wrapper function calling (results are folded back into the model response as `ChatModelFunctionCall` items), and thought segments stream as reasoning. The shared `reasoning` option maps onto the resolved chat wrapper (`resolveChatWrapper` with `customWrapperSettings`): presence enables thinking (Qwen `thoughts: "auto"`, Gemma 4 `reasoning: true`, Harmony `reasoningEffort` from `effort`) with `effort` capping thought tokens via `budgets.thoughtTokens` (default `medium`); omitting `reasoning` disables it (wrappers discourage thoughts, thought budget forced to 0 so always-thinking models close their thought segment immediately). Tool inputSchemas are standard JSON Schema but node-llama-cpp only accepts its GBNF subset (no `anyOf`/`allOf`, every listed property is required), so `gbnf-schema.ts` converts them — `anyOf`→`oneOf`, optional properties become `oneOf: [<schema>, null]` and the null markers are pruned from generated params against the original schema (`pruneOptionalNulls`) before the tool call is emitted; unsupported shapes degrade to an any-JSON-value grammar instead of failing generation.

### Model billing metadata (context window + session cost)

Each `llms` entry may carry an optional `billing` block (`src/core/models/types.ts`, `LlmBillingSchema`): `name` (required when the block is present — the models.dev model identifier), optional `context` (window size in tokens), and optional `costs` (`"input/m"`/`"output/m"` required, `"cache/m"` optional; USD per million tokens). When `billing` is omitted, `options.model` is used as the lookup name. Resolution (`src/core/utils/billing.ts`, `resolveLlmBilling`) merges config-provided fields over the models.dev catalog (`https://models.dev/catalog.json`, cached at `~/.hooman/cache/models-dev.json` and refreshed at most once daily, stale-on-failure): model ids are matched with separator normalization plus boundary containment (so `claude-haiku-4.5`, `anthropic/claude-sonnet-4-5`, and Bedrock's region-prefixed ids all resolve), preferring the provider whose id equals the model's canonical lab and falling back to the first/closest matching provider. Per-request cost is computed from additive-shape usage (`computeUsageCostUsd`; cache tiers fall back to the input rate) and accumulated at the rates of the model that served each request; once any request with usage runs unpriced, cost reporting stops for the session rather than under-reporting. Context usage is a property of the conversation, not the model: on a model switch the `used` tokens carry over and are rescaled against the new model's window (ACP pushes an immediate `usage_update` on a model config change, and again at the turn boundary after a deferred mid-turn rebuild), while accrued cost is kept. Surfaces: the ACP `usage_update` sends `used` (latest request's additive prompt total), `size` (resolved context, `0` = unknown), and `cost` (only while fully priced) alongside the `_meta["hoomanjs/tokens"]` per-turn token meter (the latest request's `in`/`cin`/`out`, not a session total — the context gauge already covers overall usage) — the VS Code webview renders a context gauge + cost in `UsageFooter.tsx`; the chat TUI's `StatusBar.tsx` middle row shows `context: N% (used/size) • tokens: … • cost: $…` (no `status:`/`turns:` tokens — activity is readable from the transcript; billing resolved on mount and re-resolved on `/model`, tracked via `BillingMeter` in `src/chat/app.tsx`). When nothing resolves (e.g. local Ollama models), neither surface shows context usage or cost.

## Code style and conventions

- **Language:** TypeScript with strict mode enabled (`tsconfig.json`).
- **Module resolution:** `NodeNext`; imports use `.js` extensions even for `.ts`/`.tsx` source files.
- **React/JSX:** `jsx: "react-jsx"` (Ink components use React 19).
- **Formatting/Linting:** No ESLint or Prettier config is present. Follow existing formatting and keep changes narrow. TypeScript unused checks are enforced through `tsconfig.json` (`noUnusedLocals`, `noUnusedParameters`).
- **File naming:** kebab-case for modules (`acp-agent.ts`, `tool-approvals.ts`).
- **Imports:** prefer explicit named imports; internal imports always include the `.js` extension.
- **State:** session-scoped agent state is stored on the Strands `appState` object; see `src/core/state/`.
- **Prompts:** static prompts are Markdown files loaded at runtime; bundled assets are copied to `dist/` by the post-build script.
- **Prompt-cache stability:** requests must stay byte-stable across turns so provider prefix caching works (explicit Anthropic/Bedrock breakpoints via `src/core/agent/prompt-cache-plugin.ts`, implicit prefix caching on MiniMax). The system prompt renders a session-stable date & time (`System.builtAt` → `environment.datetime` in `environment.md`; `get_current_time` covers precise needs) — do not add per-request dynamic content to the system prompt or fold ephemeral per-turn content into conversation history.
- **Skills:** each skill is a folder containing a `SKILL.md` with YAML frontmatter. The built-in skills live under `src/core/skills/built-in/` and are packaged into `dist/`.

## Security and operational notes

- **Tool approvals:** by default the agent asks for approval before destructive tools (`shell`, `filesystem` writes, etc.). `--yolo` disables this; use only in trusted environments.
- **Ask-user tool (`ask_user`):** built-in tool (`src/core/tools/ask-user.ts`, always registered — no config toggle) that lets the agent ask the user one multiple-choice question mid-turn and block on the answer. It is approval-exempt (`INTERNAL_ALWAYS_ALLOWED`) — the question itself is the interaction. Frontends register an `AskUserBackend` on the agent (same file, a `WeakMap` like the fs/terminal backends): `chat` uses a `ChatQuestionController` + inline `QuestionPrompt` in the bottom chrome (options, free-text answer, dismiss; `src/chat/questions.ts`), `exec` uses a numbered readline prompt when a TTY is present (`src/exec/questions.ts`), and ACP presents the question as a `session/request_permission` whose options are the answer choices plus Dismiss, tagged `_meta["hoomanjs/ask_user"]` so the VS Code extension renders a question-styled card instead of the shield permission card (`src/acp/questions.ts`), and `daemon` relays the question to the originating MCP server over the `hooman/channel/ask` capability (`src/daemon/questions.ts` + `Manager.requestChannelAsk` — the question-flavoured sibling of `hooman/channel/permission`; request goes out as `notifications/hooman/channel/ask_request`, the answer comes back as `notifications/hooman/channel/ask` with an `option_id`, free-text `answer`, or `dismissed`), falling back to `no_user_available` when the job has no channel origin, the server lacks the capability, or the relay fails/times out. With no backend registered (non-TTY `exec`, subagents) the tool returns `no_user_available` and the agent proceeds on its own judgement; dismissals return `dismissed` rather than an error. Backends may also return `{ kind: "unavailable" }` to report per-call unavailability, which maps to the same `no_user_available` result.
- **Credentials:** API keys and OAuth tokens live in `~/.hooman/config.json` and `~/.hooman/mcp-oauth.json`. Do not commit these files or paste secrets into source code.
- **Path safety:** filesystem tools normalize user paths and reject traversal outside the working directory; see `src/core/utils/normalize-user-path.ts`.
- **MCP OAuth:** remote MCP servers may trigger an OAuth flow that starts a local callback server. Review server configs in `mcp.json` before authenticating. The `client_id` is resolved as: static `oauth.clientId` → Dynamic Client Registration (when the server advertises a `registration_endpoint`) → Client ID Metadata Document (CIMD / SEP-991) via `oauth.clientMetadataUrl` (defaults to a bundled URL) when the server advertises `client_id_metadata_document_supported`. The DCR redirect URI is persisted and reused; set `oauth.callbackPort`/`oauth.redirectUri` to pin it. The CIMD document is published from `docs/public/oauth/client-metadata.json` via the `docs/` site's GitHub Pages deploy — its `client_id` field must equal the hosted URL exactly. See `src/core/mcp/oauth/`.
- **Daemon mode:** processes MCP channel notifications as queued prompts; use `--yolo` only when the channel source and tools are trusted.
- **Ripgrep bootstrap (`grep` tool):** runtime lookup order is system `rg` → `~/.hooman/bin/rg` cache → download+checksum-verify into `~/.hooman/bin/`. First use on systems without `rg` may require network access.

## Release workflow

Publishing is handled by `.github/workflows/publish-npm.yml`:

- Triggers on pushes to `main`, tags matching `v*`, and manual dispatch.
- Runs `npm ci` and `npm run build`.
- Publishes to npm with provenance only when the ref is a `refs/tags/v*` tag.

Bump the version in `package.json` and push a matching Git tag to release.
