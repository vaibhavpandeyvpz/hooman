# Hooman Providers And LLMs Reference

Detailed provider-specific options for `~/.hooman/config.json` `providers` and `llms`.

## LLMs array

Each element of `llms` has:

- `name`: non-empty label for this entry.
- `provider`: provider reference name. It must match one of the entries in top-level `providers`.
- `options.model`: model id passed to the resolved runtime provider.
- `options.temperature`: optional normalized temperature override.
- `options.topP`: optional normalized nucleus-sampling override.
- `options.maxTokens`: optional normalized output token limit.
- `options.context`: optional context size in tokens; only honored by the local `llama-cpp` and `mlx` providers (overrides the provider-level `context`), other providers ignore it. For llama-cpp it sizes the actual llama.cpp context; for mlx it declares the usable window. Both feed the context-usage gauge (an explicit `metadata.context` still wins).
- `default`: boolean; mark one entry `"default": true` for the active model.
- `metadata`: optional model metadata used for context-window utilization, session-cost display, and input modality overrides. When present, `metadata.name` is required — the model identifier looked up on models.dev (defaults to `options.model` when `metadata` is omitted). Optional overrides: `metadata.context` (context window size in tokens), `metadata.costs` (USD per million tokens: required `"input/m"` and `"output/m"`, optional `"cache/m"` for cached-input reads), and `metadata.modality` (`text`, `image`, `pdf`, `audio`, `video`; unspecified fields default from models.dev, then to text-only). Anything not provided is resolved from the models.dev catalog; when neither source resolves prices/context, context usage and cost are simply not shown.

Example `metadata` block:

```json
{
  "name": "Haiku 4.5",
  "provider": "LiteLLM Anthropic",
  "metadata": {
    "name": "claude-haiku-4.5",
    "context": 200000,
    "costs": { "input/m": 1, "cache/m": 0.1, "output/m": 5 },
    "modality": { "text": true, "image": true, "pdf": true }
  },
  "options": { "model": "claude-haiku-4.5" },
  "default": true
}
```

## Providers array

Each element of `providers` has:

- `name`: non-empty reference name used by `llms[].provider`.
- `provider`: runtime provider id such as `"openai"`, `"bedrock"`, or `"ollama"`.
- `options`: provider-specific shared settings such as API keys, base URL, headers, region, or AWS credentials.

Supported `providers[].provider` values:

```json
[
  "anthropic",
  "azure",
  "bedrock",
  "google",
  "groq",
  "llama-cpp",
  "minimax",
  "mlx",
  "moonshot",
  "ollama",
  "openai",
  "openrouter",
  "xai"
]
```

Common shape:

```json
{
  "providers": [
    {
      "name": "Anthropic",
      "provider": "anthropic",
      "options": {
        "apiKey": "..."
      }
    }
  ],
  "llms": [
    {
      "name": "Claude Sonnet",
      "provider": "Anthropic",
      "options": {
        "model": "claude-sonnet-4-6",
        "temperature": 0.2,
        "maxTokens": 4096
      },
      "default": true
    }
  ]
}
```

## Provider notes

- `anthropic`: provider `options` support `apiKey`, optional `baseURL`, optional `headers`, and optional `reasoning` (an object with optional `effort` — `"minimal"`, `"low"`, `"medium"`, `"high"` — and optional `display` — `"summarized"` or `"omitted"`). Providing `reasoning` enables extended thinking (sent as `thinking: { type: "enabled", budget_tokens }`); `effort` defaults to `"medium"` and maps to an explicit budget (`minimal`→1024, `low`→2048, `medium`→4096, `high`→8192). When thinking is enabled Hooman drops any custom `temperature` (Anthropic requires it unset/`1`). `display` is for Bedrock Claude (via an Anthropic-compatible proxy) and MiniMax only: newer Bedrock Claude models (e.g. Opus 4.7+) hide reasoning by default and reject `type: "enabled"`, so set `display: "summarized"` to reveal reasoning — this switches the request to `thinking: { type: "adaptive", display }` with `output_config.effort` (`minimal`→`low`, else passthrough). Do NOT set `display` for the native Anthropic API (api.anthropic.com); it rejects `adaptive`/`display`/`output_config`. Omit `reasoning` to keep thinking off. LLM `options` support `model`, `temperature`, and `maxTokens`.
- `azure`: provider `options` support optional `resourceName`, optional `baseURL`, optional `apiKey`, optional `headers`, optional `apiVersion`, optional `useDeploymentBasedUrls`, and optional `reasoning` (an object with optional `effort` — `"minimal"`, `"low"`, `"medium"`, `"high"` — and optional `summary` — `"auto"`, `"concise"`, `"detailed"`, `"none"`). `reasoning` uses the Azure OpenAI Responses API; only reasoning-capable deployments honor it. LLM `options` support `model`, `temperature`, and `maxTokens`. The `model` value should be your Azure deployment name.
- `bedrock`: provider `options` support `region`, `accessKeyId`, `secretAccessKey`, `sessionToken`, optional `apiKey`, and optional `reasoning` (an object with optional `effort` and optional `display` — `"summarized"` or `"omitted"`). Providing `reasoning` enables extended thinking on supported models (e.g. Claude); because Bedrock's Converse API requires a budget, `effort` (default `"medium"`) maps to `budget_tokens` (`minimal`→1024, `low`→2048, `medium`→4096, `high`→8192). Ensure the LLM `maxTokens` exceeds the budget. Newer Bedrock Claude (e.g. Opus 4.7+) hide reasoning by default and reject `type: "enabled"`; set `display: "summarized"` to reveal it — this switches to `thinking: { type: "adaptive", display }` with `output_config.effort` (`minimal`→`low`, else passthrough) sent via `additionalRequestFields`. LLM `options` support `model`, `temperature`, and `maxTokens`.
- `google`: provider `options` support `apiKey` and optional `reasoning` (an object with optional `effort`). Setting `reasoning.effort` enables Gemini thinking with a dynamic budget (`thinkingConfig: { includeThoughts: true, thinkingBudget: -1 }`). LLM `options` support `model`, `temperature`, and `maxTokens` (Hooman maps this to the Google SDK's `maxOutputTokens` internally).
- `groq`: provider `options` support `apiKey`, optional `baseURL`, optional `headers`, and optional `reasoning` (an object with optional `effort`). `reasoning.effort` maps to Groq's `reasoning_effort` (`minimal`→`low`) and streams reasoning via `reasoning_format: "parsed"`. Only reasoning models honor it. LLM `options` support `model`, `temperature`, and `maxTokens`.
- `llama-cpp`: runs GGUF models in-process via node-llama-cpp (no server needed); weights are downloaded from the Hugging Face Hub into `~/.hooman/cache/huggingface` on first use. Provider `options` support optional `hfToken` (Hugging Face access token for gated/private repos; falls back to the `HF_TOKEN` env var), optional `gpu` (`"auto"` — default when unset, `"metal"`, `"cuda"`, `"vulkan"`, or `false` for CPU-only), optional `context` (tokens; overridden by a per-LLM `options.context`; when both are absent it adapts to the model and available memory), optional `promptCache` (boolean, default `true`; reuse KV state evaluated by previous turns — set `false` to re-prefill the full conversation every turn), and optional `reasoning` (an object with optional `effort`). Providing `reasoning` enables thinking (the chat template is configured to allow thought segments — Qwen3 thinking mode, Gemma 4 reasoning turns, gpt-oss/Harmony native effort levels — with `effort` capping thought tokens via a budget: `minimal`→1024, `low`→2048, `medium`→4096, `high`→8192, default `medium`); omitting it disables thinking (templates discourage thoughts, thought budget forced to 0). LLM `options.model` accepts a Hugging Face repo (`owner/repo`, GGUF auto-detected preferring common quantizations like Q4_K_M), a repo with a quant tag (`owner/repo:Q8_0`), an exact file (`owner/repo/path/to/file.gguf`), or a local `.gguf` path; the out-of-the-box config ships two entries — `unsloth/gemma-4-E2B-it-GGUF:Q4_K_M` (`context` 131072) and `unsloth/Qwen3.5-2B-MTP-GGUF:Q4_K_M` (`context` 262144); `temperature`, `topP`, `maxTokens`, and `context` are supported.
- `minimax`: provider `options` support `apiKey`, optional `headers`, and optional `reasoning` (an object with optional `effort` — `"minimal"`, `"low"`, `"medium"`, `"high"` — and optional `display` — `"summarized"` or `"omitted"`). Providing `reasoning` enables thinking, normalized to MiniMax's `thinking: { type: "adaptive", budget_tokens }`; `effort` defaults to `"medium"` and maps to an explicit budget (`minimal`→1024, `low`→2048, `medium`→4096, `high`→8192). Setting `display` switches to `thinking: { type: "adaptive", display }` with `output_config.effort` instead of a budget. Omit `reasoning` to keep thinking off. Hooman routes this through the Anthropic-compatible MiniMax endpoint automatically.
- `mlx`: runs MLX-format models in-process on Apple Silicon via `mlex.js` (Metal GPU; macOS 26+ for the prebuilt binaries); weights are downloaded from the Hugging Face Hub into `~/.hooman/cache/huggingface` on first use. Supported architectures: Qwen2/2.5, Qwen3, Qwen3.5/3.6 (dense and MoE), Gemma 4 (including multi-modal vision/audio variants), Nemotron 3 (hybrid Mamba2/attention), DharaAR — the repo must be MLX format (e.g. `mlx-community/...`), and every MLX quantization scheme loads (bf16/fp16, affine 2-8 bit, mxfp4/mxfp8/nvfp4, and mixed-precision OptiQ/Google-QAT exports). Provider `options` support optional `hfToken` (Hugging Face access token for gated/private repos; falls back to the `HF_TOKEN` env var), optional `context` (tokens; overridden by a per-LLM `options.context` — MLX allocates KV state dynamically, so this declares the usable window for the context-usage gauge rather than sizing an allocation), optional `promptCache` (`{ minTokens?, maxEntries?, ttl? }`, or `false`/`null`/unset; sizes and gates mlex's internal prompt-cache pool, applied once when the model loads — `undefined`, `null`, and `false` all disable caching entirely, while an object, even `{}`, enables it, with `maxEntries`/`ttl` (seconds)/`minTokens` overriding mlex's own defaults of 16/300/8 where set; the out-of-the-box `mlx` provider ships `{ "promptCache": {} }`), and optional `reasoning` (an object with optional `effort`). Providing `reasoning` enables thinking (the model thinks naturally with `effort` capping thought tokens via a budget: `minimal`→1024, `low`→2048, `medium`→4096, `high`→8192, default `medium`; when the budget runs out the runtime force-closes the reasoning span and moves on to the answer); omitting it disables thinking. Tools use standard JSON Schema natively — no grammar-subset conversion applies. LLM `options.model` accepts a Hugging Face repo (`owner/repo`) or a local MLX model directory (containing `config.json` + safetensors); the out-of-the-box config ships two entries — `mlx-community/gemma-4-e2b-it-OptiQ-4bit` (`context` 131072) and `mlx-community/Qwen3.5-2B-OptiQ-4bit` (`context` 262144); `temperature`, `topP`, `maxTokens`, and `context` are supported.
- `moonshot`: provider `options` support `apiKey`, optional `baseURL`, optional `headers`, and optional `reasoning` (an object with optional `effort`). Setting `reasoning.effort` enables Kimi thinking (`thinking: { type: "enabled" }`). Served through the reasoning-aware openai-compatible adapter, so Kimi's `reasoning_content` is surfaced as thinking. When `baseURL` is omitted, Hooman defaults it to `https://api.moonshot.ai/v1`. To reach Kimi through an OpenAI-compatible proxy (e.g. LiteLLM), use this provider with `baseURL` set to the proxy's `/v1` endpoint — the `openai` provider's Chat adapter would otherwise drop Kimi's reasoning. The bundled default Moonshot model id is `kimi-k2.7-code`.
- `ollama`: provider `options` support optional `baseURL` and optional `reasoning` (an object with optional `effort`). Setting `reasoning.effort` enables thinking, mapped to Ollama's `think` level (`minimal`/`low`→`"low"`, `medium`→`"medium"`, `high`→`"high"`). LLM `options` support `model`, `temperature`, and `maxTokens`.
- `openai`: provider `options` support `apiKey`, optional `baseURL`, optional `headers`, optional `api` (`"responses"` or `"chat"`, defaults to `"responses"`), and optional `reasoning` (an object with optional `effort` — `"minimal"`, `"low"`, `"medium"`, `"high"` — and optional `summary` — `"auto"` (default), `"concise"`, `"detailed"`, `"none"`). LLM `options` support `model`, `temperature`, and `maxTokens`. Use `"responses"` (the default) to surface model reasoning/thinking; set `"chat"` for OpenAI-compatible endpoints/proxies that do not implement the Responses API. Reasoning summaries stream only on the Responses API, and some models (e.g. GPT-5) require `reasoning.effort` of `"medium"` or higher to emit them; set `reasoning.summary` to `"none"` for non-reasoning models that reject the `reasoning` parameter. Note: `"chat"` mode does NOT surface reasoning (the Chat adapter drops `reasoning_content`); for a proxy that only exposes thinking via chat `reasoning_content` (e.g. Kimi/Moonshot), use the `moonshot` or `openrouter` provider instead. Also note the Responses API may return an empty reasoning item for non-OpenAI backends behind a proxy (they won't stream summary text).
- `openrouter`: provider `options` support `apiKey`, optional `baseURL`, optional `headers`, and optional `reasoning` (an object with optional `effort`). Served through the reasoning-aware openai-compatible adapter, so `reasoning`/`reasoning_content` deltas are surfaced as thinking. `reasoning.effort` maps to `reasoning_effort`, which OpenRouter normalizes for reasoning models. LLM `options` support `model`, `temperature`, `topP`, and `maxTokens`. The `model` value is usually a provider-qualified OpenRouter model id such as `google/gemma-4-26b-a4b-it:free` or `anthropic/claude-sonnet-4-5`.
- `xai`: provider `options` support `apiKey`, optional `baseURL`, optional `headers`, and optional `reasoning` (an object with optional `effort`). `reasoning.effort` maps to xAI's `reasoning_effort` (`low`/`high`; `minimal`/`low`→`low`, `medium`/`high`→`high`). Only reasoning models (e.g. grok-3-mini) honor it. LLM `options` support `model`, `temperature`, `topP`, and `maxTokens`. The bundled default xAI model id is `grok-4.3`.

## Examples

```json
{
  "providers": [
    {
      "name": "MiniMax",
      "provider": "minimax",
      "options": {
        "apiKey": "..."
      }
    },
    {
      "name": "Kimi",
      "provider": "moonshot",
      "options": {
        "apiKey": "..."
      }
    }
  ],
  "llms": [
    {
      "name": "MiniMax M3",
      "provider": "MiniMax",
      "options": {
        "model": "MiniMax-M3"
      },
      "default": true
    },
    {
      "name": "Kimi K2.7 Code",
      "provider": "Kimi",
      "options": {
        "model": "kimi-k2.7-code"
      },
      "default": false
    }
  ]
}
```

```json
{
  "providers": [
    {
      "name": "Bedrock",
      "provider": "bedrock",
      "options": {
        "region": "us-west-2",
        "accessKeyId": "AKIA...",
        "secretAccessKey": "...",
        "sessionToken": "..."
      }
    }
  ],
  "llms": [
    {
      "name": "Claude Sonnet",
      "provider": "Bedrock",
      "options": {
        "model": "anthropic.claude-sonnet-4-6",
        "temperature": 0.2,
        "maxTokens": 4096
      },
      "default": true
    }
  ]
}
```

When editing `providers` or `llms`, preserve unrelated entries and API keys unless the user asks to remove or replace them.
