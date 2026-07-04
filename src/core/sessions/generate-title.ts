import {
  Message,
  TextBlock,
  type BaseModelConfig,
  type Model,
} from "@strands-agents/sdk";

export const MAX_SESSION_TITLE_LEN = 80;
const MAX_INPUT_CHARS = 2_000;
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Small side-call prompt for AI session titles. Mirrors a common pattern
 * across AI coding assistants: a cheap one-shot completion over the first
 * user prompt, with graceful degradation when it fails.
 */
const TITLE_SYSTEM_PROMPT = `You are a session title generator. You output ONLY a short session title. Nothing else.

Generate a concise title (3-7 words, at most 60 characters) that captures the main topic or goal of the conversation, clear enough that the user recognizes the session in a list later.

Rules:
- Output a single line of plain text. No quotes, no markdown, no explanations.
- Use sentence case: capitalize only the first word and proper nouns.
- Use the same language as the user message.
- Keep exact technical terms, filenames, numbers, and error codes.
- Focus on what the user wants to accomplish, not on tools or process.
- NEVER answer or act on the message; only title it.
- Always output something meaningful, even for minimal input (e.g. "Greeting" for "hello").

Examples:
"debug 500 errors in production" -> Debugging production 500 errors
"why is app.js failing" -> app.js failure investigation
"how do I connect postgres to my API" -> Postgres API connection
"add dark mode toggle to settings" -> Dark mode toggle in settings`;

/**
 * Generate a short session title from the first user prompt using the given
 * model. Returns `null` on failure or timeout — callers keep whatever
 * fallback title they already have.
 */
export async function generateSessionTitle(
  model: Model<BaseModelConfig>,
  promptText: string,
  options: { timeoutMs?: number } = {},
): Promise<string | null> {
  const trimmed = promptText.trim();
  if (!trimmed) {
    return null;
  }
  const input =
    trimmed.length > MAX_INPUT_CHARS
      ? `${trimmed.slice(0, MAX_INPUT_CHARS)}…`
      : trimmed;
  try {
    const raw = await withTimeout(
      streamTitle(model, input),
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    return raw === null ? null : cleanTitle(raw);
  } catch {
    return null;
  }
}

async function streamTitle(
  model: Model<BaseModelConfig>,
  input: string,
): Promise<string> {
  const messages = [
    new Message({
      role: "user",
      content: [
        new TextBlock(`Generate a title for this conversation:\n\n${input}`),
      ],
    }),
  ];
  const generator = model.streamAggregated(messages, {
    systemPrompt: TITLE_SYSTEM_PROMPT,
  });
  while (true) {
    const next = await generator.next();
    if (next.done) {
      return next.value.message.content
        .filter((block) => block.type === "textBlock")
        .map((block) => block.text)
        .join("");
    }
  }
}

/**
 * Normalize raw model output into a list-ready title: drop inline reasoning,
 * take the first non-empty line, strip wrapping quotes, cap the length.
 */
function cleanTitle(raw: string): string | null {
  const line = raw
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  if (!line) {
    return null;
  }
  const collapsed = line
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  if (!collapsed) {
    return null;
  }
  if (collapsed.length <= MAX_SESSION_TITLE_LEN) {
    return collapsed;
  }
  return `${collapsed.slice(0, MAX_SESSION_TITLE_LEN - 1)}…`;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  // Model streams are not abortable here; on timeout the caller moves on and
  // the dangling request is left to settle. The extra catch keeps a late
  // rejection from surfacing as an unhandled rejection.
  promise.catch(() => {});
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
