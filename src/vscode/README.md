<div align="center">
  <img src="https://raw.githubusercontent.com/vaibhavpandeyvpz/hooman/main/src/vscode/media/icon.png" alt="Hooman logo" width="96" />
  <h1>Hooman for VS Code</h1>
  <p>
    Chat with <a href="https://github.com/vaibhavpandeyvpz/hooman">Hooman</a> — a hackable, local-first AI agent — without leaving your editor.
  </p>
  <p>
    <img src="https://raw.githubusercontent.com/vaibhavpandeyvpz/hooman/main/src/vscode/media/screenshot.png" alt="Hooman chat panel in VS Code" width="480" />
  </p>
</div>

Hooman adds a chat panel to your activity bar, powered by the [Hooman CLI](https://www.npmjs.com/package/hoomanjs)'s Agent Client Protocol ([ACP](https://agentclientprotocol.com)) agent. Bring your own provider — Anthropic, OpenAI, Google, Ollama, OpenRouter, and [more](https://github.com/vaibhavpandeyvpz/hooman#features) — and let the agent read, edit, and run things in your workspace while you review and approve each step.

- Works in **stable VS Code, VS Code Insiders, and VS Code-compatible forks**.
- **No special subscription**, no proposed APIs, no gating of any kind.
- **Local-first**: your configuration, API keys, and sessions live in `~/.hooman` on your machine. No account, no telemetry.

## Features

- **Streaming chat** with full markdown rendering and collapsible thinking (with a "thought for Xs · ~N tokens" summary).
- **Tool-call cards** with live status — shell commands stream their output into the card as they run.
- **Review every edit**: files the agent writes appear in a pinned **Changes** panel. Click a file to open a native diff against its pre-edit baseline, then **Keep** or **Undo** each change (or all at once). Edits go through undo-able workspace edits, and the agent sees your unsaved buffers.
- **Plan checklist** pinned above the transcript, updated live as the agent works through it.
- **Queue and steer**: follow-ups sent mid-turn don't interrupt — they land in a **Queued** panel where you can edit, remove, or **Send now**. **Steer now** injects the queue as guidance into the running turn instead of waiting for it to finish.
- **Attachments**: add files, folders, and images via the paperclip button, drag & drop (from the OS or the Explorer), or paste from the clipboard.
- **Sessions persist**: the history button in the panel's title bar opens a **Sessions** overlay — saved sessions grouped by day (Today / Yesterday / …) with search, the ongoing one marked (spinner while a turn runs), click-to-open, per-session delete, and a New Chat action.
- **Pill pickers** in the composer for mode (Agent / Plan / Ask / Yolo), model, and reasoning effort — plus `/` slash-command autocomplete (`/compact`, `/init`).
- **Inline permission prompts**: the agent asks before running destructive tools; approve or reject right in the panel (Yolo mode auto-approves).
- **Status bar item** showing the current model and mode, with a spinner while a turn runs and a quick menu for all session controls.
- **Token-usage footer** with cumulative input / cached / output token totals for the session.

## Quick start

1. Install [Node.js](https://nodejs.org) `>= 24` (`npx` ships with it — that's all the extension needs).
2. Install this extension.
3. Click the **Hooman icon in the activity bar** and send a prompt. The extension launches the agent via `npx hoomanjs acp`, downloading the CLI on first use — no separate install step.
4. Pick your provider and model. Out of the box, Hooman is configured for a local [Ollama](https://ollama.com) instance. To use a hosted provider instead, either:
   - click **Open Settings…** (gear icon in the panel title bar) to edit `~/.hooman/config.json` directly, or
   - run `npx hoomanjs` in a terminal and use the `/config` workflow.

   See the [Hooman configuration docs](https://github.com/vaibhavpandeyvpz/hooman#configuration-layout) for the full schema, supported providers, and MCP server setup.

## Commands

- **Hooman: New Chat** — start a fresh session in the chat panel.
- **Hooman: Open Session…** — opens the Sessions overlay in the chat panel: saved sessions grouped by day, searchable, with the ongoing one marked (spinner while busy), click-to-open, and per-session delete.
- **Hooman: Open Settings…** — opens `config.json` or `mcp.json` from `~/.hooman/` (or `$HOOMAN_HOME/`) in an editor tab, scaffolding it first if it doesn't exist yet.
- **Hooman: Show Output Channel** — opens the "Hooman" output channel with the agent's logs.
- **Hooman: Delete All Sessions** — deletes every persisted session after a confirmation prompt.

## Extension settings

By default the extension runs the agent through `npx`, resolving the [`hoomanjs`](https://www.npmjs.com/package/hoomanjs) package on demand. If you'd rather pin a specific binary or a local build, point these settings at it:

| Setting              | Default               | Purpose                                |
| -------------------- | --------------------- | -------------------------------------- |
| `hooman.acp.command` | `npx`                 | Executable used to launch the agent.   |
| `hooman.acp.args`    | `["hoomanjs", "acp"]` | Arguments passed to the command above. |

Example using a globally installed or locally built CLI:

```json
{
  "hooman.acp.command": "node",
  "hooman.acp.args": ["/absolute/path/to/hooman/dist/cli.js", "acp"]
}
```

Everything else — providers, models, API keys, MCP servers, skills — is Hooman's own configuration under `~/.hooman/`, shared with the CLI.

## Troubleshooting

- **Nothing happens / the panel says the agent failed to start**: run **Hooman: Show Output Channel**. It logs the spawned process's stderr and connection activity — check here first.
- **First prompt is slow**: `npx` may be downloading `hoomanjs` on first use. Subsequent launches use the cache.
- **Wrong or no model**: the agent uses your `~/.hooman/config.json`. Verify it works in a terminal with `npx hoomanjs exec "hello"`.

## Development

The extension lives in [`src/vscode/`](https://github.com/vaibhavpandeyvpz/hooman/tree/main/src/vscode) of the Hooman repository as a self-contained sub-package (its own `package.json` and dependencies, excluded from the root build).

```bash
cd src/vscode
npm install
npm run compile   # typecheck + esbuild (extension host) + vite build (webview)
npm run watch     # rebuild all three on save
npm run package   # -> hooman-vscode-<version>.vsix (fully bundled, no node_modules)
```

To debug, open the repository root in VS Code (after running `npm install` in `src/vscode/` at least once) and press **F5** — the root [`.vscode/launch.json`](https://github.com/vaibhavpandeyvpz/hooman/blob/main/.vscode/launch.json) and [`.vscode/tasks.json`](https://github.com/vaibhavpandeyvpz/hooman/blob/main/.vscode/tasks.json) point at `src/vscode` so there's no need to `cd` in or open it as a separate workspace.

Architecture in brief: one `hooman acp` process serves the panel for the extension's lifetime, with every chat session multiplexed over it as an ACP session. The extension implements the client-side ACP `fs/*` capabilities against VS Code's workspace APIs (so the agent sees dirty buffers and edits are undo-able) and `terminal/*` via child processes (for byte-accurate output). The panel UI is a SolidJS + Tailwind webview bundled by Vite; the extension host is bundled by esbuild. See the [repository docs](https://github.com/vaibhavpandeyvpz/hooman/blob/main/AGENTS.md) for the full breakdown.

## License

[MIT](https://github.com/vaibhavpandeyvpz/hooman/blob/main/LICENSE) © [Vaibhav Pandey](https://vaibhavpandey.com)
