# Changelog

All notable changes to the Hooman VS Code extension are documented in this file.

## [1.45.2]

- Make new tabs interactive immediately instead of waiting for ACP to bootstrap: clicking "+ new tab" or resuming a not-yet-loaded session now opens the tab right away with a dedicated **Starting session…** overlay (logo, spinner, and a three-line skeleton under a "Preparing your chat" header), the composer is disabled with its own "Starting session…" placeholder, the tab strip shows a spinner for tabs that are still bootstrapping (not just tabs that are busy with a turn), and the submit / drag-drop / paste / slash-command paths all stay quiet until the ACP session is ready -- so the chat feels responsive on cold start and queued prompts are no longer racing against the `session/new` roundtrip. The placeholder tab id is renamed to the real ACP session id once bootstrap completes, with no flicker of the empty state in between.
- Fix activated MCP tools that the agent could see in `search_tools` but couldn't actually call: `LazyToolRegistry.get()` now also looks up activated-by-name tools (respecting the active MCP tool set and current session mode) instead of only direct registry hits, so a tool that was activated via `activate_tools` resolves correctly the moment the agent tries to use it.
- Display Markdown tables nicely in chat: tables from the assistant (and any rendered Markdown) now render as actual bordered tables inside a rounded card -- per-cell padding, a subtle header tint that picks up the editor's active chrome, and a horizontal scroll bar when a row is wider than the chat -- instead of a run of loose `<p>` blocks with `---` separators.

## [1.45.1]

- Lazy MCP tool discovery to keep large servers off the prompt: connected MCP tools are no longer registered with the agent by default -- they are parked in a hidden catalog and exposed on demand via a new pair of read-only, approval-exempt tools, `search_tools` (natural-language query, default top-5 / max 10 results, with `name`, `description`, `server`, `readOnly`, `args`, `modes`, and per-tool `active` flag) and `activate_tools` (activate 1--10 named MCP tools for the current session, with per-tool `activatable` / `skipped` reasons). Activated MCP tools become available on the next model cycle, and a tool that is blocked by the current session mode (`ask` / `plan`) is skipped on activation rather than exposed. Built-in Hooman tools remain registered directly and bypass the discovery step.
- Fix MCP OAuth refresh logic so background reconnects no longer abort: the OAuth provider's `redirectUrl` now returns a deterministic `http://127.0.0.1[:<port>]/mcp/oauth/callback` fallback when no callback server is bound (instead of throwing), and the auth-status check in both the core service and the VS Code settings UI now considers a token "authenticated" when a `refresh_token` is present even if `expires_in` / `expiresAt` has elapsed -- so expired-but-refreshable tokens stop flashing "expired" and stop re-prompting the user to log in.
- Make MCP discovery tool output deterministic and model-safe: `search_tools` now serializes each catalog entry through an explicit shape (`name`, `description`, `server`, `readOnly`, `args`, `modes`, optional `active`/`activatable`/`score`/`why`) instead of `JSON.parse(JSON.stringify(...))` round-trips, so live `Tool` instances can't leak through into tool results.
- Compact the Changes-panel header: the per-file **Undo all** and primary **Keep all** pills in the VS Code chat's pinned Changes panel are now tighter (`px-2 py-0.5` / `px-2.5 py-0.5` with shared transitions on hover) so the header doesn't dominate the panel on long change lists.

## [1.45.0]

- Custom editors for Hooman's own config files: `.hooman/config.json`, `.hooman/mcp.json`, and `.hooman/instructions.md` now open in dedicated VS Code custom-text-editor views (`Hooman Configuration`, `Hooman MCP`, `Hooman Instructions`) with a rich webview UI on top of the underlying JSON/Markdown, so settings can be edited visually without hand-writing the files.
- Manage providers, LLMs, MCP servers, web search, tool and prompt toggles from the new **Settings** view inside the chat activity bar: add/edit/delete providers and LLMs, switch the default model, add/edit/delete MCP servers (with per-server OAuth login/logout, project-vs-global scope, and configurable transport fields), and toggle the built-in tools and prompt sections.
- Browse, search, install, and uninstall skills in-place: a new **Skills** view inside the chat activity bar lists the locally installed skills, searches the `skills.sh` registry, and runs the `skills` CLI to add or remove skills without leaving VS Code.
- Project-local MCP overlays everywhere: MCP servers defined in a project's `.hooman/mcp.json` now overlay the global `~/.hooman/mcp.json` for both the chat and the `hooman mcp` CLI subcommands (`auth`, `logout`, `auth-status`, etc.), and the Settings UI's MCP editor honors the same global/project scope when saving new servers.
- Better session tabs: the multi-chat tab bar is now styled like native VS Code editor tabs (active/inactive/hover backgrounds, focus top border, close-X on the tab), auto-scrolls the active tab into view as new tabs open, and routes close-actions only when the user clicks the close-X so the tab body keeps activating on click.
- "Implement this plan" prompt: clicking **Build** on a plan (from the plan editor, the plan menu, or a plan chip in chat) now submits `Implement this plan now: <path>` to the agent instead of the previous `Build this plan now: <path>` wording, so the model treats the request as an implementation step rather than a build/compile step.
- Plans require explicit approval: `exit_plan_mode` is no longer auto-approved by yolo or the always-allow list, the approval prompt no longer offers an "always allow" option for plan exits (CLI prompt and VS Code approval dialog), and the agent now has to get a per-plan confirmation before leaving plan mode.
- Configure UX polish: the `hooman configure` wizard gained dedicated screens for creating providers and LLMs (with provider-type selection and editable drafts) and clearer copy for OAuth and provider toggles, so adding a new model is a guided flow instead of a single all-in-one form.

## [1.44.1]

- Plan file structural improvements: entering plan mode now seeds a structured YAML frontmatter (`name`, `overview`, `tasks: []`, `status: pending`) so plans round-trip cleanly through the editor and CLI, the plan-mode prompt requires `name`/`overview`/`tasks` with `description` and `status` per task, and the agent-mode prompt keeps the plan's `tasks` section synchronized with `update_todos`. The plan editor's sidebar/checklist was renamed from "Todos" to "Tasks" to match the new frontmatter shape.

## [1.44.0]

- Send the selected editor text to Hooman Chat from the editor context menu: "Add Selection to Hooman Chat" / "Add Selection to New Hooman Chat", plus matching explorer-tree commands for selected files/folders, and a floating CodeLens over the active selection. The selection is staged as a composer chip and sent to the agent as a `resource_link` with a `#Lstart-Lend` fragment when applicable.
- Open links from rendered Markdown with the host editor instead of the webview: `http(s)`/`mailto` links go through `vscode.env.openExternal`, and relative or absolute filesystem paths open in an editor tab using the active session's cwd.
- Open plan files (`.plan.md`) in a dedicated custom-text-editor view: a richer plan editor with a parsed checklist, a Build menu (build / refresh / edit raw markdown), per-session mode/model pickers, and live sync between the chat's pinned plan checklist and the on-disk plan file. Plan files reached from any surface — markdown links in chat, the Changes-panel fallback, or attachment previews — route through the custom editor instead of the plain text editor.
- Fix full-turn cost accumulation in the usage footer: output tokens and cost now correctly sum across every model request in a turn (input/cached-input still reflect the latest request, matching the CLI TUI's per-turn meter), and the per-turn token totals update in real time as the turn progresses.
- Open multiple chats side-by-side: a new tab bar above the chat shows each session's title (with a spinner while busy, a pending-permission badge, and an unread dot when it finishes in the background), supports per-tab close with confirmation and a `+` button to open a new tab, persists tabs across reloads, and is capped at 8 open tabs per chat view. Each tab keeps its own transcript, plan, queued prompts, changes, downloads, draft, and usage footer.
- Copy or fork the latest assistant message: hovering it exposes a **Copy** icon (raw markdown to the clipboard, with a brief "Copied" check) and a **Fork** icon that duplicates the current chat into a new tab titled `<name> (fork)` with the full history, working directory, mode, and model preserved.
- Fix agent file edits leaving open editor tabs with an unsaved-buffer dot: `FsBackend.writeTextFile` now saves the open document immediately after the agent rewrites it, so the rewritten content is on disk and the tab is clean without a manual ⌘S.
- Refresh the Changes panel: hover-revealed icon Keep/Undo buttons (with screen-reader labels), a primary "Keep All" pill button, and Hooman's own plan files (`.plan.md`) no longer appear in the list.
- Add a retry strategy for transient model failures: a live "Request failed · retrying in Xs · attempt N/M" card in the chat with an expandable error detail, and exponential backoff up to 10 attempts for rate limits (HTTP 408/409/425/429), 5xx errors, and common network blips.
- Webview polish: render the agent's reasoning (expanded thought blocks) as markdown instead of plain preformatted text, and stop the chat or plan view from briefly flashing the wrong UI before the first route message lands — an unknown route now shows a friendly empty-state card.

## [1.43.1]

- Add a bundled local `mlx` provider for Apple Silicon on macOS 26+: the extension's packaged agent now ships MLX presets for Qwen3.5 9B, Nemotron 3 Nano 4B, and Gemma 4 12B, downloaded from the Hugging Face Hub on first use and run in-process via Metal.
- Show output tokens per second in the usage footer for the latest request, alongside the existing input, cache, output, context-window, and session-cost meters.
- Make local-model usage reporting more accurate: configured `llama-cpp` and `mlx` context windows now feed the context gauge, and MLX local inference is treated as free local execution rather than priced like a hosted API.

## [1.42.1]

- Fix session cost in the usage footer for local llama.cpp/Ollama models: local inference is free, so catalog prices for the hosted API of the same model id are no longer applied — only the context-window gauge shows for these providers now.
- The bundled llama.cpp models (Qwen3 1.7B, Qwen3.5 0.8B, Gemma 4 E2B) now default to GPU-accelerated inference (Metal/CUDA/Vulkan, auto-detected) and are pinned to their full training context windows out of the box.

## [1.42.0]

- Add a model download strip above the composer: live progress (bar, percent, transferred/total size, speed, ETA — per shard for sharded GGUFs) while a local llama.cpp model downloads its weights on first use, fed by a new `_hoomanjs/model_download` ACP notification.
- The bundled agent now ships a local `llama-cpp` provider that runs GGUF models in-process via node-llama-cpp — the new out-of-the-box default, with Qwen3 1.7B (default), Qwen3.5 0.8B, and Gemma 4 E2B presets downloaded from the Hugging Face Hub on first use. No API keys needed for the first prompt.
- Harden the agent's stdio discipline in ACP mode: all stray console/SDK logging is routed away from stdout so library chatter can't corrupt the JSON-RPC channel.

## [1.41.1]

- Fix the publisher ID so the extension can be published to the VS Code Marketplace.
- Fix token usage reporting for MiniMax models in the usage footer.
- Fix a prompt-cache invalidation issue that could bust the Anthropic/Bedrock prefix cache on every turn.

## [1.41.0]

- Initial public release: a self-contained chat panel in the activity bar, backed by `hooman acp`.
- Streaming markdown, collapsible thinking, tool-call cards, pinned Plan/Changes/Queued panels, and a token-usage footer.
- Native diff review (Keep/Undo) for agent edits via the pinned Changes panel.
- Mid-turn steering, prompt queueing, and attachment support (files, folders, images, pasted/dropped content).
- Session picker, status bar item, and slash-command autocomplete.
