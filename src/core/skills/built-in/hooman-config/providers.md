# Hooman Providers And LLMs Reference

Detailed provider-specific options for `~/.hooman/config.json` `providers` and `llms`.

## LLMs array

Each element of `llms` has:

- `name`: non-empty label for this entry.
- `provider`: provider reference name. It must match one of the entries in top-level `providers`.
- `options.model`: model id passed to the resolved runtime provider.
- `options.temperature`: optional normalized temperature override.
- `options.maxTokens`: optional normalized output token limit.
- `default`: boolean; mark one entry `"default": true` for the active model.
- `billing`: optional billing metadata used for context-window utilization and session-cost display. When present, `billing.name` is required — the model identifier looked up on models.dev (defaults to `options.model` when `billing` is omitted). Optional overrides: `billing.context` (context window size in tokens) and `billing.costs` (USD per million tokens: required `"input/m"` and `"output/m"`, optional `"cache/m"` for cached-input reads). Anything not provided is resolved from the models.dev catalog; when neither source resolves, context usage and cost are simply not shown.

Example `billing` block:

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
        "model": "claude-sonnet-4-20250514",
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
- `llama-cpp`: runs GGUF models in-process via node-llama-cpp (no server needed); weights are downloaded from the Hugging Face Hub into `~/.hooman/cache/huggingface` on first use. Provider `options` support optional `hfToken` (Hugging Face access token for gated/private repos; falls back to the `HF_TOKEN` env var), optional `gpu` (`"auto"` — default, `"metal"`, `"cuda"`, `"vulkan"`, or `false` for CPU-only), optional `contextSize` (tokens; defaults to adapting to the model and available memory), and optional `reasoning` (an object with optional `effort`). Providing `reasoning` enables thinking (the chat template is configured to allow thought segments — Qwen3 thinking mode, Gemma 4 reasoning turns, gpt-oss/Harmony native effort levels — with `effort` capping thought tokens via a budget: `minimal`→1024, `low`→2048, `medium`→4096, `high`→8192, default `medium`); omitting it disables thinking (templates discourage thoughts, thought budget forced to 0). LLM `options.model` accepts a Hugging Face repo (`owner/repo`, GGUF auto-detected preferring common quantizations like Q4_K_M), a repo with a quant tag (`owner/repo:Q8_0`), an exact file (`owner/repo/path/to/file.gguf`), or a local `.gguf` path; the out-of-the-box config ships two entries — `Qwen/Qwen3-1.7B-GGUF:Q8_0` (default) and `unsloth/gemma-4-E2B-it-GGUF:Q8_0`; `temperature` and `maxTokens` are supported.
- `minimax`: provider `options` support `apiKey`, optional `headers`, and optional `reasoning` (an object with optional `effort` — `"minimal"`, `"low"`, `"medium"`, `"high"` — and optional `display` — `"summarized"` or `"omitted"`). Providing `reasoning` enables thinking, normalized to MiniMax's `thinking: { type: "adaptive", budget_tokens }`; `effort` defaults to `"medium"` and maps to an explicit budget (`minimal`→1024, `low`→2048, `medium`→4096, `high`→8192). Setting `display` switches to `thinking: { type: "adaptive", display }` with `output_config.effort` instead of a budget. Omit `reasoning` to keep thinking off. Hooman routes this through the Anthropic-compatible MiniMax endpoint automatically.
- `moonshot`: provider `options` support `apiKey`, optional `baseURL`, optional `headers`, and optional `reasoning` (an object with optional `effort`). Setting `reasoning.effort` enables Kimi thinking (`thinking: { type: "enabled" }`). Served through the reasoning-aware openai-compatible adapter, so Kimi's `reasoning_content` is surfaced as thinking. When `baseURL` is omitted, Hooman defaults it to `https://api.moonshot.ai/v1`. To reach Kimi through an OpenAI-compatible proxy (e.g. LiteLLM), use this provider with `baseURL` set to the proxy's `/v1` endpoint — the `openai` provider's Chat adapter would otherwise drop Kimi's reasoning.
- `ollama`: provider `options` support optional `baseURL` and optional `reasoning` (an object with optional `effort`). Setting `reasoning.effort` enables thinking, mapped to Ollama's `think` level (`minimal`/`low`→`"low"`, `medium`→`"medium"`, `high`→`"high"`). LLM `options` support `model`, `temperature`, and `maxTokens`.
- `openai`: provider `options` support `apiKey`, optional `baseURL`, optional `headers`, optional `api` (`"responses"` or `"chat"`, defaults to `"responses"`), and optional `reasoning` (an object with optional `effort` — `"minimal"`, `"low"`, `"medium"`, `"high"` — and optional `summary` — `"auto"` (default), `"concise"`, `"detailed"`, `"none"`). LLM `options` support `model`, `temperature`, and `maxTokens`. Use `"responses"` (the default) to surface model reasoning/thinking; set `"chat"` for OpenAI-compatible endpoints/proxies that do not implement the Responses API. Reasoning summaries stream only on the Responses API, and some models (e.g. GPT-5) require `reasoning.effort` of `"medium"` or higher to emit them; set `reasoning.summary` to `"none"` for non-reasoning models that reject the `reasoning` parameter. Note: `"chat"` mode does NOT surface reasoning (the Chat adapter drops `reasoning_content`); for a proxy that only exposes thinking via chat `reasoning_content` (e.g. Kimi/Moonshot), use the `moonshot` or `openrouter` provider instead. Also note the Responses API may return an empty reasoning item for non-OpenAI backends behind a proxy (they won't stream summary text).
- `openrouter`: provider `options` support `apiKey`, optional `baseURL`, optional `headers`, and optional `reasoning` (an object with optional `effort`). Served through the reasoning-aware openai-compatible adapter, so `reasoning`/`reasoning_content` deltas are surfaced as thinking. `reasoning.effort` maps to `reasoning_effort`, which OpenRouter normalizes for reasoning models. LLM `options` support `model`, `temperature`, and `maxTokens`. The `model` value is usually a provider-qualified OpenRouter model id such as `anthropic/claude-3.5-sonnet`.
- `xai`: provider `options` support `apiKey`, optional `baseURL`, optional `headers`, and optional `reasoning` (an object with optional `effort`). `reasoning.effort` maps to xAI's `reasoning_effort` (`low`/`high`; `minimal`/`low`→`low`, `medium`/`high`→`high`). Only reasoning models (e.g. grok-3-mini) honor it. LLM `options` support `model`, `temperature`, and `maxTokens`.

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
        "model": "anthropic.claude-sonnet-4-20250514-v1:0",
        "temperature": 0.2,
        "maxTokens": 4096
      },
      "default": true
    }
  ]
}
```

When editing `providers` or `llms`, preserve unrelated entries and API keys unless the user asks to remove or replace them.
