import { marked, type Token } from "marked";

const TOKEN_CACHE_MAX = 500;
const tokenCache = new Map<string, Token[]>();
let markedConfigured = false;

const MD_SYNTAX_RE = /[#*`|[>\-_~]|\n\n|^\d+\. |\n\d+\. /;

function hashContent(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 33) ^ input.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function hasMarkdownSyntax(value: string): boolean {
  const sample = value.length > 500 ? value.slice(0, 500) : value;
  return MD_SYNTAX_RE.test(sample);
}

function paragraphToken(value: string): Token[] {
  return [
    {
      type: "paragraph",
      raw: value,
      text: value,
      tokens: [
        {
          type: "text",
          raw: value,
          text: value,
        },
      ],
    } as Token,
  ];
}

function lexer(content: string): Token[] {
  configureMarked();
  if (!hasMarkdownSyntax(content)) {
    return paragraphToken(content);
  }
  return marked.lexer(content);
}

export function configureMarked(): void {
  if (markedConfigured) {
    return;
  }
  markedConfigured = true;
  marked.use({ gfm: true, breaks: false });
}

export function lexMarkdown(content: string): Token[] {
  const key = hashContent(content);
  const hit = tokenCache.get(key);
  if (hit) {
    tokenCache.delete(key);
    tokenCache.set(key, hit);
    return hit;
  }
  const tokens = lexer(content);
  if (tokenCache.size >= TOKEN_CACHE_MAX) {
    const oldest = tokenCache.keys().next().value;
    if (oldest !== undefined) {
      tokenCache.delete(oldest);
    }
  }
  tokenCache.set(key, tokens);
  return tokens;
}

export function splitStreamingMarkdown(
  content: string,
  stablePrefix: string,
): { stablePrefix: string; unstableSuffix: string } {
  configureMarked();
  let currentStablePrefix = stablePrefix;
  if (!content.startsWith(currentStablePrefix)) {
    currentStablePrefix = "";
  }
  const boundary = currentStablePrefix.length;
  const tokens = lexer(content.slice(boundary));
  let lastContentIndex = tokens.length - 1;
  while (lastContentIndex >= 0 && tokens[lastContentIndex]?.type === "space") {
    lastContentIndex -= 1;
  }
  let advance = 0;
  for (let index = 0; index < lastContentIndex; index += 1) {
    advance += tokens[index]?.raw.length ?? 0;
  }
  if (advance > 0) {
    currentStablePrefix = content.slice(0, boundary + advance);
  }
  return {
    stablePrefix: currentStablePrefix,
    unstableSuffix: content.slice(currentStablePrefix.length),
  };
}
