# Changelog

All notable changes to the Hooman VS Code extension are documented in this file.

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
