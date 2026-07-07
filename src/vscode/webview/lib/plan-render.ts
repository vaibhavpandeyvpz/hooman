import { load as loadYaml } from "js-yaml";

export type TodoItem = { content: string; status?: string };

/**
 * Split a leading `--- ... ---` YAML frontmatter block from Markdown.
 *
 * Kept dependency-light and browser-safe on purpose: `gray-matter` reaches for
 * Node's `Buffer`, which is undefined in the webview and throws on any
 * non-empty document, so parsing must not rely on it here.
 */
function splitFrontmatter(text: string): { data: unknown; content: string } {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(
    text,
  );
  if (!match) {
    return { data: {}, content: text };
  }
  let data: unknown = {};
  try {
    data = loadYaml(match[1]) ?? {};
  } catch {
    data = {};
  }
  return { data, content: text.slice(match[0].length) };
}

type ParsedPlan = {
  title: string;
  overview?: string;
  status?: string;
  todos: TodoItem[];
  rawRemainder: string;
  structured: boolean;
};

/**
 * Parse a plan file using YAML frontmatter for metadata and todos, falling
 * back to plain Markdown heading detection.
 */
export function parsePlanText(text: string, fallbackTitle: string): ParsedPlan {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      title: fallbackTitle,
      todos: [],
      rawRemainder: "",
      structured: false,
    };
  }

  const parsed = splitFrontmatter(text);
  const data: Record<string, unknown> =
    parsed.data && typeof parsed.data === "object"
      ? (parsed.data as Record<string, unknown>)
      : {};
  const hasFrontmatter = Object.keys(data).length > 0;

  const todos = parseTodos(data.todos);
  const remainder = parsed.content.trim();

  return {
    title:
      asString(data.name) ||
      asString(data.title) ||
      headingTitle(remainder) ||
      headingTitle(text) ||
      fallbackTitle,
    overview: asString(data.overview),
    status: asString(data.status),
    todos,
    rawRemainder: remainder,
    structured: hasFrontmatter,
  };
}

function parseTodos(value: unknown): TodoItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const items: TodoItem[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      items.push({ content: entry });
    } else if (entry && typeof entry === "object") {
      const content = asString(entry.content) ?? asString(entry.name) ?? "";
      items.push({
        content,
        status: asString(entry.status),
      });
    }
  }
  return items;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return undefined;
  }
  return String(value);
}

function headingTitle(text: string): string | undefined {
  const match = /^#\s+(.+)$/m.exec(text);
  return match?.[1]?.trim();
}
