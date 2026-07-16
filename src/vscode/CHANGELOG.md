# Changelog

All notable changes to the Hooman VS Code extension are documented in this file.

## [1.57.1]

- Fix the `edit_file` tool schema so its supported operation modes are described correctly.
- Align filesystem tool documentation with the current editing API and remove stale `write_file` references.
- Improve npm lockfile reproducibility and CI/CD installation and packaging behavior.

## [1.57.0]

- Add text-based `edit_file` replacement mode with tolerant matching, optional replace-all behavior, and sequential multi-edit application.
- Improve line-edit boundary handling and file excerpt reporting for empty or end-of-file ranges.
- Improve VS Code change tracking and ACP launch behavior, including removal of external `npx`/`bunx` execution and clearer diff statistics.
- Refresh the documentation surface and Product Hunt promotion.

## [1.56.0]

- Introduce a shared filesystem backend architecture with local and remote backends, richer text-file access, and structured multi-file editing operations.
- Add ACP support for remote filesystem reads and writes so VS Code sessions can use the client's filesystem capabilities through the new backend.
- Report subagent token usage and costs through ACP session updates, and improve approval and session-mode handling around fresh plans.
- Refresh filesystem tool locations and tool-kind metadata to match the new editing surface.

## [1.55.3]

- Resolve model output limits from `models.dev` when `maxTokens` is not explicitly configured.
- Show stopping feedback while cancelling a turn and prevent duplicate cancellation requests.
- Fix slash-command visibility and session creation ordering so commands and early session updates are not lost.

## [1.55.2]

- Fix spawning the Hooman ACP process on Windows: `resolveHoomanLaunch` now returns a `shell` flag (enabled on Windows for `npx`/`bunx` runners) and the ACP client passes it to `spawn`, so the `.cmd` shims resolve correctly and the agent starts (#37).

## [1.55.1]

- Fix a name collision in the VS Code Marketplace by changing the extension `displayName` from "Hooman" to "Hooman for VS Code".

## [1.55.0]

- Introduce **Design mode** for producing HTML artifacts: a new `design` session mode, a built-in `hooman-design` skill, and a complete design workflow (brand discovery → template/theme selection → build → preview → visual QA → export) that writes prototypes, decks, dashboards, and other layouts under `.hooman/design/<slug>/index.html`.
- Export design artifacts to multiple delivery formats: PDF, PowerPoint-ready `.pptx`, Figma-ready `.fig`, and Sketch-ready `.sketch`, plus screenshot-backed deck exports, using Playwright-based rendering and dedicated export utilities.
- Add a local **preview server** and **browser tool** so the agent can render, screenshot, and inspect HTML artifacts during design work, with a shared browser backend wired through both the CLI and ACP.
- Launch a guided **first-run onboarding** experience: the new `hooman setup` Ink wizard walks users through provider/model selection and writes an initial `~/.hooman/config.json`, backed by `onboarding-config` helpers and a new VS Code onboarding view.
- Extend CLI bootstrap options: `--model` selects a configured named LLM, `--effort` sets reasoning effort per provider, and `--continue` resumes the latest session in the current project.
- Add a `switch_mode` tool so the agent can move between session modes (agent, ask, plan, design) mid-conversation.
- Refresh the VS Code chat webview with an **Onboarding** view, new provider logos, and updated chrome that matches the shared brand tokens.
- Rename agent prompts for clarity (`code-review`, `quality-analyst`) and add a `design-review` agent for the design-mode QA step.
- Update the docs site with new mode guides (agent, ask, plan, design), a design-mode guide, refreshed hero/screenshots, and new install scripts (`install.sh` / `install.ps1`).
- Add new dependencies for design/export workflows: `playwright`, `pptxgenjs`, `pdf-lib`, `openfig-core`, `@sketch-hq/sketch-file-format-ts`, `cheerio`, `fflate`, `serve-handler`, and `zstd-codec`.

## [1.47.0]

- Run shell commands in the background: the `shell` tool now spawns long-running jobs through a new `ShellJobManager` (with `SHELL_OUTPUT_TOOL_NAME` / `SHELL_STOP_TOOL_NAME` companions), so the agent can keep working while a process is still producing output, peek at partial output, cancel a job, and resume from where it left off instead of waiting synchronously. The old `src/core/tools/shell.ts` path has moved to `src/core/shell/` and the public types (`ShellJobEvent`, `ShellJobInfo`, `ShellJobOutputSnapshot`, `ShellJobStatus`, `TerminalSpawnResult`) are re-exported from `hoomanjs`. The chat UI now shows a dedicated **Background jobs** panel, and the VS Code webview gets a complementary **Background jobs** bar in the tab strip that lists live jobs across the active session.
- Auto-scroll the chat transcript to the latest turn when new content arrives, so streaming responses, tool events, and background-job updates stay in view without manual scrolling.
- Revert the chat to an earlier in-memory prompt or checkpoint: ACP and the VS Code webview store per-message boundaries (`turn-boundaries`), the new edit-tracker hooks into pending file edits, and a **Restore to here** action on each user message rewinds the session state in place without touching disk.
- Show fork and copy actions on every final assistant response in a chat (not just the most recent), so older turns can be reused or branched from.
- Handle permission and tool cancellation per the ACP spec: the VS Code composer and status strip now surface cooperative cancel results from the agent, and the editor's pending-prompt state stays consistent when a permission request is withdrawn mid-turn.
- Render `yolo` as a true boolean setting: the auto-approve toggle is now stored and displayed as a checkbox rather than as a sentinel string, and the corresponding `AGENTS.md` guidance has been updated.
- Move "Reasoning Effort" into the `model_config` category so it lives alongside the rest of the per-model knobs in the Settings UI.
- Use VS Code's native confirmation dialogs for destructive actions in the **Settings** view (e.g. removing an MCP server, deleting a skill, reverting to defaults), instead of rendering a custom in-webview confirm. The webview **Settings** editor is correspondingly simpler and faster to render.
- Apply the shared brand tokens consistently across the CLI Ink UI, the VS Code webview, the docs site, and the AGENTS guidelines, so primary/secondary/warning/error/success/info/muted accents come from a single source of truth.
- Render Mermaid diagrams in chat and in the planner, so fenced `mermaid` blocks from the assistant show as flowcharts/sequence/ER diagrams instead of raw source.
- Refresh bundled documentation and built-in skills, including updates to the ACP, CLI, and VS Code guides and reworked release/CD workflows (`.github/workflows/cd.yml`, `ci.yml`, `docs.yml`).

## [1.46.0]

- Add a richer Hooman settings experience in VS Code: the extension now exposes configurable settings for newly added root configuration fields, replaces the dedicated plan editor webview with a settings-focused editor experience, and keeps the shared ACP/settings protocol in sync with the expanded configuration surface.
- Improve core agent and CLI capabilities used by the extension: Hooman now supports working-directory skills, browser-related tool toggles, `topP` model configuration, modality-aware input blocks, gitignored-path protection for filesystem access, and improved plan-task/checklist handling.
- Refresh bundled documentation and built-in skills, including the new bump-and-release workflow used for repository releases.

## [1.45.4]

- CI/CD fixes only.

## [1.45.3]

- No more `node`/`npx` on your PATH required to run the agent: the extension now resolves the Hooman ACP launcher through a three-step ladder -- (1) an explicit `hooman.acp.command`/`hooman.acp.args` override is honored verbatim, (2) otherwise `bunx`/`npx` on PATH is used to run `hoomanjs@<extension version>` (preferring Bun), and (3) if neither is available it downloads a prebuilt, self-contained CLI tarball for your platform from the matching GitHub release (checksum-verified, extracted to `~/.hooman/cli/<version>/`) and runs it with VS Code's own bundled Node runtime. The download happens once per version behind the usual session loader plus a "downloading agent runtime" progress notification, is shared across concurrent sessions, and surfaces as a normal session-load error if it fails. Local inference runtimes (`node-llama-cpp`, and `mlex.js` on Apple Silicon) ship inside the downloaded tarball, so MLX/llama.cpp models work fully offline without a separate install step.

## [1.45.2]

- Make new tabs interactive immediately instead of waiting for ACP to bootstrap: clicking "+ new tab" or resuming a not-yet-loaded session now opens the tab right away with a dedicated **Starting session…** overlay (logo, spinner, and a three-line skeleton under a "Preparing your chat" header), the composer is disabled with its own "Starting session…" placeholder, the tab strip shows a spinner for tabs that are still bootstrapping (not just tabs that are busy with a turn), and the submit / drag-drop / paste / slash-command paths all stay quiet until the ACP session is ready -- so the chat feels responsive on cold start and queued prompts are no longer racing against the `session/new` roundtrip. The placeholder tab id is renamed to the real ACP session id once bootstrap completes, with no flicker of the empty state in between.
- Fix activated MCP tools that the agent could see in `search_tools` but couldn't actually call: `LazyToolRegistry.get()` now also looks up activated-by-name tools (respecting the active MCP tool set and current session mode) instead of only direct registry hits, so a tool that was activated via `activate_tools` resolves correctly the moment the agent tries to use it.
- Display Markdown tables nicely in chat: tables from the assistant (and any rendered Markdown) now render as actual bordered tables inside a rounded card -- per-cell padding, a subtle header tint that picks up the editor's active chrome, and a horizontal scroll bar when a row is wider than the chat -- instead of a run of loose `<p>` blocks with `---` separators.

## [1.45.1]

- Lazy MCP tool discovery to keep large servers off the prompt: connected MCP tools are no longer registered with the agent by default -- they are parked in a hidden catalog and exposed on demand via a new pair of read-only, approval-exempt tools, `search_tools` (natural-language query, default top-5 / max 10 results, with `name`, `description`, `server`, `readOnly`, `args`, `modes`, and per-tool `active` flag) and `activate_tools` (activate 1--10 named MCP tools for the current session, with per-tool `activatable` / `skipped` reasons). Activated MCP tools become available on the next model cycle, and a tool that is blocked by the current session mode (`ask` / `plan`) is skipped on activation rather than exposed. Built-in Hooman tools remain registered directly and bypass the discovery step.
- Fix MCP OAuth refresh logic so background reconnects no longer abort: the OAuth provider's `redirectUrl` now returns a deterministic `http://127.0.0.1[:<port>]/mcp/oauth/callback` fallback when no callback server is bound (instead of throwing), and the OAuth status check in both the core service and the VS Code settings UI now considers a token "authenticated" when a `refresh_token` is present even if `expires_in` / `expiresAt` has elapsed -- so expired-but-refreshable tokens stop flashing "expired" and stop re-prompting the user to log in.
- Make MCP discovery tool output deterministic and model-safe: `search_tools` now serializes each catalog entry through an explicit shape (`name`, `description`, `server`, `readOnly`, `args`, `modes`, optional `active`/`activatable`/`score`/`why`) instead of `JSON.parse(JSON.stringify(...))` round-trips, so live `Tool` instances can't leak through into tool results.
- Compact the Changes-panel header: the per-file **Undo all** and primary **Keep all** pills in the VS Code chat's pinned Changes panel are now tighter (`px-2 py-0.5` / `px-2.5 py-0.5` with shared transitions on hover) so the header doesn't dominate the panel on long change lists.

## [1.45.0]

- Custom editors for Hooman's own config files: `.hooman/config.json`, `.hooman/mcp.json`, and `.hooman/instructions.md` now open in dedicated VS Code custom-text-editor views (`Hooman Configuration`, `Hooman MCP`, `Hooman Instructions`) with a rich webview UI on top of the underlying JSON/Markdown, so settings can be edited visually without hand-writing the files.
- Manage providers, LLMs, MCP servers, web search, tool and prompt toggles from the new **Settings** view inside the chat activity bar: add/edit/delete providers and LLMs, switch the default model, add/edit/delete MCP servers (with per-server OAuth login/logout, project-vs-global scope, and configurable transport fields), and toggle the built-in tools and prompt sections.
- Browse, search, install, and uninstall skills in-place: a new **Skills** view inside the chat activity bar lists the locally installed skills, searches the `skills.sh` registry, and runs the `skills` CLI to add or remove skills without leaving VS Code.
- Project-local MCP overlays everywhere: MCP servers defined in a project's `.hooman/mcp.json` now overlay the global `~/.hooman/mcp.json` for both the chat and the `hooman mcp` CLI subcommands (`auth`, `logout`, `status`, etc.), and the Settings UI's MCP editor honors the same global/project scope when saving new servers.
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
