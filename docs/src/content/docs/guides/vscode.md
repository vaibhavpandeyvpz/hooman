---
title: VS Code
description: The hooman-vscode chat panel — features, quick start, settings, and development.
---

`src/vscode/` ships a self-contained VS Code extension (`hooman-vscode`) that bridges [`hooman acp`](/hooman/guides/acp/) into the editor with a native **Hooman chat panel** in the activity bar.

Works in **stable VS Code, VS Code Insiders, and compatible forks** — no proposed APIs and no special subscription required. Local-first: your configuration, API keys, and sessions live in `~/.hooman` on your machine — no account, no telemetry.

Install it from the **[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=VPZ.hooman-vscode)**, or see the [VS Code quickstart](/hooman/quickstart-vscode/) for step-by-step setup.

## Features

- **Streaming chat** with full markdown rendering (including clickable links, tables, and live **Mermaid** diagrams from fenced `mermaid` code blocks), and collapsible thinking (with a "thought for Xs · ~N tokens" summary).
- **Multi-tab sessions**: work several chat sessions side by side in the same panel via a tab strip — open, switch, reorder, and close tabs without losing any in-flight turn.
- **Tool-call cards** with live status — shell commands stream their output into the card as they run. Failed requests that Hooman retries show a **retry card** with attempt count and backoff instead of silently failing. Stopping a turn cancels pending permission prompts and marks unfinished tool cards as cancelled.
- **Review every edit**: files the agent writes appear in a pinned **Changes** panel. Click a file to open a native diff against its pre-edit baseline, then **Keep** or **Undo** each change (or all at once). Edits go through undo-able workspace edits, and the agent sees your unsaved buffers.
- **Plan checklist** pinned above the transcript, updated live as the agent works through it, backed by a dedicated **Plan editor** custom view for `*.plan.md` files (checklist + Mermaid in the plan body). Leaving plan mode (`exit_plan_mode`) always requires explicit approval, even with Yolo/auto-approve on.
- **Message actions**: copy any message, or **fork the chat** from each turn's final assistant reply into a new session/tab. On a user message that still has an in-memory checkpoint, **Revert** restores files touched from that turn onward, rewinds agent history, and puts the prompt back in the composer (native confirmation dialog; not available for replayed history).
- **Queue and steer**: follow-ups sent mid-turn land in a **Queued** panel where you can edit, remove, or **Send now**. **Steer now** injects the queue as guidance into the running turn instead of waiting for it to finish.
- **Attachments**: add files, folders, and images via the paperclip button, drag & drop, or paste from the clipboard. Right-click a file in the Explorer (or select text in an editor) for **Add to Hooman Chat** / **Add to New Hooman Chat** (and the selection-scoped variants) to send it straight into the panel. Attachments are filtered to modalities the active model supports — see [LLM metadata](/hooman/guides/configuration/models/#llm-metadata).
- **Sessions persist**: a **Sessions** overlay lists saved sessions grouped by day, searchable, with the ongoing one marked, click-to-open, per-session delete, and a New Chat action.
- **Composer controls** for session mode (Agent / Plan / Ask), model, reasoning effort, and a separate **Yolo** toggle (auto-approve tool calls — not a mode), plus `/` slash-command autocomplete (`/compact`, `/init`).
- **Inline permission prompts**: the agent asks before running destructive tools; approve or reject right in the panel (Yolo auto-approves — except leaving plan mode, which always prompts). Destructive deletes and revert use VS Code's native confirmation dialogs.
- **Status bar item** showing the current model and mode, with a spinner while a turn runs and a quick menu for all session controls.
- **Token-usage footer** with real-time accumulated token counts for the in-flight turn plus the latest request's input / cached / output counts, a context-window gauge, and cumulative session cost — see [LLM metadata](/hooman/guides/configuration/models/#llm-metadata).
- **Model download strip**: when a local [llama.cpp](/hooman/guides/configuration/models/llama-cpp/) model downloads its weights on first use, a progress strip shows percent, size, speed, and ETA above the composer.
- **Native settings editors**: dedicated custom editors for `config.json` (providers, models, prompts, tools, compaction, and fields such as `topP` / modality metadata) and `mcp.json` (add/edit/remove servers with field-by-field forms), plus a **Skills** panel to search, install, refresh, and remove skills — all without leaving VS Code. `instructions.md` opens in VS Code's default Markdown editor. These read/write the same nearest project-local `.hooman/` overlay or `~/.hooman/` files the CLI uses.

## Quick start

1. Install [Node.js](https://nodejs.org) `>= 24` (`npx` ships with it — that's all the extension needs).
2. Install the extension from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=VPZ.hooman-vscode).
3. Click the **Hooman icon in the activity bar** and send a prompt. The extension launches the agent via `npx hoomanjs acp`, downloading the CLI on first use — no separate install step.
4. Pick your provider and model. Out of the box, Hooman ships local [llama.cpp](/hooman/guides/configuration/models/llama-cpp/) presets for Gemma 4 E2B and Qwen3.5 2B (downloaded from the Hugging Face Hub on first use), plus Apple-Silicon-only [MLX](/hooman/guides/configuration/models/mlx/) presets for the same two models. To use a hosted provider instead, either:
   - click **Open Settings…** (gear icon in the panel title bar) to edit `~/.hooman/config.json` directly, or
   - run `npx hoomanjs` in a terminal and use the [`/config`](/hooman/guides/cli/#config) workflow.

   See [Configuration](/hooman/guides/configuration/) and [Models](/hooman/guides/configuration/models/) for the full schema.

## Commands

- **Hooman: New Chat** — start a fresh session (new tab) in the chat panel.
- **Hooman: Open Session…** — opens the Sessions overlay: saved sessions grouped by day, searchable, ongoing marked, click-to-open, per-session delete.
- **Hooman: Open Settings…** — opens the native **Configuration** editor for `config.json`, scaffolding it first if needed; `mcp.json` opens in the **Hooman MCP** custom editor when opened directly, `instructions.md` opens in the default Markdown editor, and a **Skills** panel manages installed skills.
- **Add to Hooman Chat** / **Add to New Hooman Chat** — Explorer context-menu commands that send the selected file(s) into the current or a new chat tab.
- **Add Selection to Hooman Chat** / **Add Selection to New Hooman Chat** — editor context-menu commands (shown when text is selected) that send the selection into the current or a new chat tab.
- **Hooman: Show Output Channel** — opens the "Hooman" output channel with the agent's logs.
- **Hooman: Delete All Sessions** — deletes every persisted session after a confirmation prompt.

## Extension settings

By default the extension runs the agent through `npx`, resolving [`hoomanjs`](https://www.npmjs.com/package/hoomanjs) on demand. If you'd rather pin a specific binary or a local build:

| Setting              | Default               | Purpose                                |
| -------------------- | --------------------- | -------------------------------------- |
| `hooman.acp.command` | `npx`                 | Executable used to launch the agent.   |
| `hooman.acp.args`    | `["hoomanjs", "acp"]` | Arguments passed to the command above. |

```json
{
  "hooman.acp.command": "node",
  "hooman.acp.args": ["/absolute/path/to/hooman/dist/cli.js", "acp"]
}
```

Everything else — providers, models, API keys, MCP servers, skills — is Hooman's own configuration under `~/.hooman/`, shared with the CLI.

## Troubleshooting

- **Nothing happens / the panel says the agent failed to start** — run **Hooman: Show Output Channel**. It logs the spawned process's stderr and connection activity.
- **First prompt is slow** — `npx` may be downloading `hoomanjs` on first use; subsequent launches use the cache.
- **Wrong or no model** — the agent uses your `~/.hooman/config.json`. Verify it works in a terminal with `npx hoomanjs exec "hello"`.

## Development

The extension lives in [`src/vscode/`](https://github.com/vaibhavpandeyvpz/hooman/tree/main/src/vscode) of the Hooman repository as a self-contained sub-package (its own `package.json` and dependencies, excluded from the root build).

```bash
cd src/vscode
npm install
npm run compile   # typecheck + esbuild (extension host) + vite build (webview)
npm run watch     # rebuild all three on save
npm run package   # -> hooman-vscode-<version>.vsix (fully bundled, no node_modules)
```

Install the packaged `.vsix` into any VS Code-compatible editor:

```bash
code --install-extension hooman-vscode-<version>.vsix
```

To debug, open the repository root in VS Code (after running `npm install` in `src/vscode/` at least once) and press **F5** — the root `.vscode/launch.json` and `.vscode/tasks.json` point at `src/vscode`, so there's no need to `cd` in or open it as a separate workspace.

Architecture in brief: one `hooman acp` process serves the panel for the extension's lifetime, with every chat session multiplexed over it as an ACP session. The extension implements the client-side ACP `fs/*` capabilities against VS Code's workspace APIs (so the agent sees dirty buffers and edits are undo-able) and `terminal/*` via child processes. The panel UI is a SolidJS + Tailwind webview bundled by Vite; the extension host is bundled by esbuild. See [`src/vscode/README.md`](https://github.com/vaibhavpandeyvpz/hooman/blob/main/src/vscode/README.md) in the repository for the full breakdown.
