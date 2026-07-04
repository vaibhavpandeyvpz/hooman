import {
  CachePointBlock,
  InvokeModelStage,
  Message,
  TextBlock,
} from "@strands-agents/sdk";
import type {
  LocalAgent,
  Plugin,
  SystemContentBlock,
  SystemPrompt,
} from "@strands-agents/sdk";
import { LlmProvider } from "../models/types.js";

/**
 * Providers whose Strands model adapter honors `CachePointBlock` breakpoints
 * (they emit Anthropic `cache_control` / Bedrock `cachePoint`). Every other
 * provider either caches automatically server-side (OpenAI, Azure/Vercel) or
 * warns and ignores cache points, so we skip them to avoid noise/errors.
 */
const CACHE_CAPABLE_PROVIDERS: ReadonlySet<string> = new Set([
  LlmProvider.Anthropic,
  LlmProvider.Bedrock,
]);

const CACHEABLE_BLOCK_TYPES: ReadonlySet<string> = new Set([
  "textBlock",
  "imageBlock",
  "toolUseBlock",
  "toolResultBlock",
  "documentBlock",
]);

/**
 * Adds prompt-cache breakpoints to model input for providers that require them.
 *
 * The Anthropic and Bedrock adapters only cache when a `CachePointBlock`
 * immediately follows a cacheable block. hooman otherwise sends a plain string
 * system prompt with no breakpoints, so nothing is ever cached on those
 * providers. This plugin runs at {@link InvokeModelStage.Input} — after skills
 * / session-mode injection — and appends:
 *
 * - one cache point at the end of the system prompt (caches the stable
 *   `tools → system` prefix), and
 * - one rolling cache point at the end of the last message (caches the growing
 *   conversation prefix across the agentic tool loop).
 *
 * Two breakpoints stays well under Anthropic's four-breakpoint limit. Providers
 * that cache automatically (OpenAI, Azure) are left untouched.
 *
 * @param getProvider - Returns the current provider type; evaluated per call so
 * runtime model switches (chat `/model`, ACP) are respected.
 */
export function createPromptCachePlugin(opts: {
  getProvider: () => string;
}): Plugin {
  return {
    name: "hooman:prompt-cache",
    initAgent(agent: LocalAgent): void {
      agent.addMiddleware(InvokeModelStage.Input, (context) => {
        if (!CACHE_CAPABLE_PROVIDERS.has(opts.getProvider())) {
          return context;
        }
        return {
          ...context,
          systemPrompt: withSystemCachePoint(context.systemPrompt),
          messages: withLastMessageCachePoint(context.messages),
        };
      });
    },
  };
}

function withSystemCachePoint(
  prompt: SystemPrompt | undefined,
): SystemPrompt | undefined {
  if (prompt === undefined) {
    return prompt;
  }
  const blocks: SystemContentBlock[] =
    typeof prompt === "string"
      ? prompt.length > 0
        ? [new TextBlock(prompt)]
        : []
      : [...prompt];
  if (blocks.length === 0) {
    return prompt;
  }
  const last = blocks[blocks.length - 1];
  if (last && last.type === "cachePointBlock") {
    return blocks;
  }
  blocks.push(new CachePointBlock({ cacheType: "default" }));
  return blocks;
}

function withLastMessageCachePoint(
  messages: readonly Message[],
): readonly Message[] {
  if (messages.length === 0) {
    return messages;
  }
  const index = messages.length - 1;
  const last = messages[index]!;
  const content = last.content;
  const tail = content[content.length - 1];
  // Nothing to anchor the breakpoint to, or one is already present.
  if (!tail || !CACHEABLE_BLOCK_TYPES.has(tail.type)) {
    return messages;
  }
  const next = [...messages];
  next[index] = new Message({
    role: last.role,
    content: [...content, new CachePointBlock({ cacheType: "default" })],
    ...(last.metadata !== undefined && { metadata: last.metadata }),
  });
  return next;
}
