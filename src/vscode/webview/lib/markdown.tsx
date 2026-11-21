import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { SolidMarkdown } from "solid-markdown";
import mermaid from "mermaid";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { FileText, Folder } from "lucide-solid";
import { openLink } from "../store";

export interface ParsedFilePath {
  rawPath: string;
  cleanPath: string;
  displayName: string;
  isDir: boolean;
  line?: number;
  col?: number;
}

const KNOWN_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "jsonc", "jsonl",
  "html", "htm", "css", "scss", "sass", "less", "svg", "vue", "svelte", "astro",
  "yml", "yaml", "toml", "ini", "xml", "csv", "tsv", "env", "sql", "graphql", "gql", "proto",
  "md", "markdown", "mdx", "txt", "rst", "pdf", "log",
  "py", "pyi", "sh", "bash", "zsh", "fish", "rs", "go", "java", "kt", "kts",
  "c", "cpp", "cc", "cxx", "h", "hpp", "hxx", "cs", "rb", "php", "swift",
  "dart", "lua", "r", "scala", "clj", "ex", "exs", "erl", "zig",
  "lock", "mod", "sum", "png", "jpg", "jpeg", "gif", "webp", "ico", "wasm",
]);

const KNOWN_FILENAMES = new Set([
  "dockerfile", "makefile", "gemfile", "procfile", "rakefile", "vagrantfile", "jenkinsfile",
  ".gitignore", ".gitmodules", ".gitattributes", ".dockerignore", ".npmignore",
  ".editorconfig", ".prettierrc", ".eslintrc", ".babelrc",
  "license", "readme", "changelog", "contributing",
]);

export function parseFilePath(raw: string): ParsedFilePath | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^['"`<([{\s]+|['"`>)\]},;:\s]+$/g, "");
  if (!trimmed || trimmed.length < 2 || trimmed.length > 260) {
    return null;
  }
  if (/\s/.test(trimmed)) {
    return null;
  }
  if (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) &&
    !trimmed.toLowerCase().startsWith("file://")
  ) {
    return null;
  }
  if (trimmed.startsWith("--") || trimmed.startsWith("$")) {
    return null;
  }
  if (
    trimmed.includes("()") ||
    trimmed.includes("[]") ||
    trimmed.includes("=>")
  ) {
    return null;
  }

  let line: number | undefined;
  let col: number | undefined;
  let pathWithoutLine = trimmed;

  const hashMatch = pathWithoutLine.match(/#(?:L)?(\d+)(?:-L?(\d+))?$/i);
  if (hashMatch) {
    line = parseInt(hashMatch[1], 10);
    pathWithoutLine = pathWithoutLine.slice(0, hashMatch.index);
  }

  const colonMatch = pathWithoutLine.match(/:(\d+)(?::(\d+))?$/);
  if (colonMatch) {
    if (line === undefined) {
      line = parseInt(colonMatch[1], 10);
      if (colonMatch[2]) {
        col = parseInt(colonMatch[2], 10);
      }
    }
    pathWithoutLine = pathWithoutLine.slice(0, colonMatch.index);
  }

  let clean = pathWithoutLine.trim();
  if (clean.toLowerCase().startsWith("file://")) {
    clean = clean.replace(/^file:\/\//i, "");
  }
  if (!clean) return null;

  const isDir = clean.endsWith("/") || clean.endsWith("\\");
  const normClean = isDir ? clean.slice(0, -1) : clean;
  const segments = normClean.split(/[/\\]/);
  const baseName = segments[segments.length - 1] || "";
  const lowerBase = baseName.toLowerCase();

  const isExplicitPath =
    clean.startsWith("/") ||
    clean.startsWith("./") ||
    clean.startsWith("../") ||
    clean.startsWith("~/") ||
    trimmed.toLowerCase().startsWith("file://");

  if (isDir) {
    if (segments.length >= 1 && baseName.length > 0) {
      return {
        rawPath: trimmed,
        cleanPath: clean,
        displayName: trimmed,
        isDir: true,
      };
    }
  }

  const dotIndex = baseName.lastIndexOf(".");
  if (dotIndex > 0 && dotIndex < baseName.length - 1) {
    const ext = baseName.slice(dotIndex + 1).toLowerCase();
    if (KNOWN_EXTENSIONS.has(ext)) {
      return {
        rawPath: trimmed,
        cleanPath: clean,
        displayName: trimmed,
        isDir: false,
        line,
        col,
      };
    }
  }

  if (
    KNOWN_FILENAMES.has(lowerBase) ||
    (baseName.startsWith(".") && baseName.length > 1)
  ) {
    return {
      rawPath: trimmed,
      cleanPath: clean,
      displayName: trimmed,
      isDir: false,
      line,
      col,
    };
  }

  if (isExplicitPath && segments.length > 1) {
    return {
      rawPath: trimmed,
      cleanPath: clean,
      displayName: trimmed,
      isDir: false,
      line,
      col,
    };
  }

  return null;
}

const CANDIDATE_PATH_REGEX =
  /(?:^|[\s([{"'`])([~/a-zA-Z0-9_.-]+(?:\/[~/a-zA-Z0-9_.-]+)*\.[a-zA-Z0-9_-]+(?::\d+(?::\d+)?)?|[~/a-zA-Z0-9_.-]+(?:\/[~/a-zA-Z0-9_.-]+)+\/?)(?=[),;.:!?"'`}\]\s]|$)/g;

function splitTextByFilePaths(
  text: string,
): Array<{ type: string; value: string }> {
  const parts: Array<{ type: string; value: string }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  CANDIDATE_PATH_REGEX.lastIndex = 0;

  while ((match = CANDIDATE_PATH_REGEX.exec(text)) !== null) {
    const candidate = match[1];
    if (!candidate) {
      continue;
    }
    const parsed = parseFilePath(candidate);
    if (parsed) {
      const matchStart = match.index + (match[0].length - candidate.length);
      if (matchStart > lastIndex) {
        parts.push({ type: "text", value: text.slice(lastIndex, matchStart) });
      }
      parts.push({ type: "inlineCode", value: candidate });
      lastIndex = matchStart + candidate.length;
    }
  }

  if (parts.length === 0) {
    return [{ type: "text", value: text }];
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", value: text.slice(lastIndex) });
  }
  return parts;
}

/**
 * Automatically recognizes bare file paths mentioned in plain text paragraphs
 * and turns them into inlineCode AST nodes so that `MarkdownCode` renders them
 * as interactive, clickable file reference pills.
 */
function remarkAutoLinkFiles() {
  return (tree: unknown) => {
    function walk(node: unknown) {
      if (!node || typeof node !== "object") {
        return;
      }
      const parent = node as {
        type?: string;
        children?: unknown[];
      };
      if (Array.isArray(parent.children)) {
        const nextChildren: unknown[] = [];
        for (const child of parent.children) {
          const c = child as {
            type?: string;
            value?: string;
            children?: unknown[];
          };
          if (c?.type === "text" && typeof c.value === "string") {
            const parts = splitTextByFilePaths(c.value);
            nextChildren.push(...parts);
          } else {
            nextChildren.push(child);
            if (
              c?.type !== "code" &&
              c?.type !== "inlineCode" &&
              c?.type !== "link"
            ) {
              walk(child);
            }
          }
        }
        parent.children = nextChildren;
      }
    }
    walk(tree);
  };
}

const remarkPlugins = [remarkGfm, remarkBreaks, remarkAutoLinkFiles];

export function FileMention(props: {
  path: string;
  isDir?: boolean;
  line?: number;
  col?: number;
  children?: unknown;
}) {
  const handleClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openLink(props.path);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      openLink(props.path);
    }
  };

  const title = () => {
    if (props.isDir) {
      return `Open directory ${props.path} in file explorer`;
    }
    if (props.line !== undefined) {
      return `Open ${props.path} at line ${props.line} in editor`;
    }
    return `Open ${props.path} in editor`;
  };

  return (
    <span
      role="button"
      tabindex="0"
      class="group/file file-mention-pill inline-flex items-center gap-1 mx-0.5 my-0.5 px-1.5 py-0.5 rounded border border-border/80 bg-panel text-[12px] font-mono text-foreground hover:border-accent hover:text-accent hover:bg-list-hover-bg transition-colors cursor-pointer select-none align-baseline"
      title={title()}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <span class="inline-flex shrink-0 text-muted group-hover/file:text-accent">
        {props.isDir ? <Folder size={11} /> : <FileText size={11} />}
      </span>
      <span class="group-hover/file:underline font-medium">
        {(props.children ?? props.path) as never}
      </span>
    </span>
  );
}

function cssVar(name: string, fallback = ""): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

type HastNode = {
  type?: string;
  value?: string;
  tagName?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
};

/** Concatenate the raw text content of a hast element (its `text` descendants). */
function hastText(node: HastNode | undefined): string {
  if (!node) {
    return "";
  }
  if (node.type === "text") {
    return node.value ?? "";
  }
  return (node.children ?? []).map((child) => hastText(child)).join("");
}

/** Read the `language-xxx` class name off a hast code node. */
function hastLanguage(node: HastNode | undefined): string | undefined {
  const raw = node?.properties?.className;
  const classes = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === "string"
      ? raw.split(/\s+/)
      : [];
  return classes
    .find((name) => name.startsWith("language-"))
    ?.slice("language-".length)
    .toLowerCase();
}

async function renderMermaidDiagram(code: string): Promise<string> {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: {
      background: cssVar("--color-background", "#1e1e1e"),
      primaryColor: cssVar("--color-primary", "#0091cd"),
      primaryTextColor: cssVar("--color-foreground", "#cccccc"),
      primaryBorderColor: cssVar("--color-secondary", "#56a0d3"),
      lineColor: cssVar("--color-muted", "#999999"),
      textColor: cssVar("--color-foreground", "#cccccc"),
      mainBkg: cssVar("--color-panel", "#252526"),
      secondBkg: cssVar("--color-code-bg", "#1f1f1f"),
      tertiaryColor: cssVar("--color-info", "#c4dff6"),
      clusterBkg: cssVar("--color-background", "#1e1e1e"),
      clusterBorder: cssVar("--color-border", "#3c3c3c"),
      defaultLinkColor: cssVar("--color-muted", "#999999"),
      edgeLabelBackground: cssVar("--color-background", "#1e1e1e"),
      fontFamily: cssVar("--font-sans", "sans-serif"),
    },
    flowchart: {
      useMaxWidth: true,
      htmlLabels: true,
    },
  });
  const id = `hooman-mermaid-${Math.random().toString(36).slice(2)}`;
  const { svg, bindFunctions } = await mermaid.render(id, code);
  const host = document.createElement("div");
  host.innerHTML = svg;
  bindFunctions?.(host);
  return host.innerHTML;
}

/**
 * Intercepts clicks on rendered Markdown links: `http(s)`/`mailto` links are
 * handed to the host for `vscode.env.openExternal`, and filesystem paths are
 * opened in an editor tab (or revealed in Explorer) by the host.
 */
function MarkdownLink(props: { href?: string; children?: unknown }) {
  const href = () => props.href ?? "";
  const isExternal = () =>
    /^[a-z][a-z0-9+.-]*:\/\//i.test(href()) &&
    !href().toLowerCase().startsWith("file://");

  const fileInfo = () => (!isExternal() ? parseFilePath(href()) : null);

  return (
    <a
      href={href()}
      class={`cursor-pointer transition-colors ${
        isExternal()
          ? "text-accent hover:underline"
          : "group/file file-mention-pill inline-flex items-center gap-1 mx-0.5 my-0.5 px-1.5 py-0.5 rounded border border-border/80 bg-panel text-[12px] font-mono text-accent hover:border-accent hover:underline select-none align-baseline"
      }`}
      title={
        isExternal()
          ? href()
          : fileInfo()?.line !== undefined
            ? `Open ${href()} at line ${fileInfo()?.line} in editor`
            : `Open ${href()} in editor`
      }
      onClick={(event) => {
        event.preventDefault();
        if (href()) {
          openLink(href());
        }
      }}
    >
      <Show when={!isExternal()}>
        <span class="inline-flex shrink-0 text-muted group-hover/file:text-accent">
          {fileInfo()?.isDir ? <Folder size={11} /> : <FileText size={11} />}
        </span>
      </Show>
      <span class={!isExternal() ? "font-medium" : ""}>
        {props.children as never}
      </span>
    </a>
  );
}

function MermaidBlock(props: { code: string }) {
  const [svg, setSvg] = createSignal<string>("");
  const [error, setError] = createSignal<string>("");
  let disposed = false;

  createEffect(() => {
    const source = props.code.trim();
    setSvg("");
    setError("");
    if (!source) {
      return;
    }
    void renderMermaidDiagram(source)
      .then((output) => {
        if (!disposed) {
          setSvg(output);
        }
      })
      .catch((cause: unknown) => {
        if (!disposed) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
  });

  onCleanup(() => {
    disposed = true;
  });

  return (
    <div class="my-4 overflow-x-auto">
      <Show
        when={svg()}
        fallback={
          error() ? (
            <div class="space-y-3">
              <p class="text-xs font-medium uppercase tracking-wide text-muted">
                Mermaid render failed
              </p>
              <pre class="overflow-x-auto rounded-lg border border-border bg-[var(--vscode-editor-background)] p-3 text-[12px] leading-relaxed text-[var(--vscode-editor-foreground)]">
                <code>{props.code}</code>
              </pre>
              <p class="text-xs text-danger">{error()}</p>
            </div>
          ) : (
            <p class="text-xs text-muted">Rendering Mermaid diagram…</p>
          )
        }
      >
        <div
          class="mermaid-diagram [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
          innerHTML={svg()}
        />
      </Show>
    </div>
  );
}

function MarkdownCode(props: {
  inline?: boolean;
  class?: string;
  node?: HastNode;
  children?: unknown;
}) {
  const language = () => hastLanguage(props.node);
  const text = () => hastText(props.node).replace(/\n$/, "");
  const isMermaid = () => !props.inline && language() === "mermaid";

  if (isMermaid()) {
    return <MermaidBlock code={text()} />;
  }

  if (props.inline) {
    const raw = hastText(props.node).trim();
    const fileInfo = parseFilePath(raw);
    if (fileInfo) {
      return (
        <FileMention
          path={fileInfo.rawPath}
          isDir={fileInfo.isDir}
          line={fileInfo.line}
          col={fileInfo.col}
        >
          {fileInfo.displayName}
        </FileMention>
      );
    }
    return <code class={props.class}>{props.children as never}</code>;
  }

  return (
    <pre class={props.class}>
      <code class={props.class}>{props.children as never}</code>
    </pre>
  );
}

/**
 * Markdown renderer for assistant messages and plan bodies.
 *
 * Uses `solid-markdown` so content is rendered as Solid elements instead of
 * being injected via `innerHTML`.
 */
export function Markdown(props: { children: string; class?: string }) {
  return (
    <SolidMarkdown
      class={`markdown-body ${props.class ?? ""}`}
      remarkPlugins={remarkPlugins}
      components={{ a: MarkdownLink, code: MarkdownCode }}
    >
      {props.children}
    </SolidMarkdown>
  );
}
