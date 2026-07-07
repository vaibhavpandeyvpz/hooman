# Changelog

All notable changes to the Hooman VS Code extension are documented in this file.

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
