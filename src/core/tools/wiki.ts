import fs from "node:fs/promises";
import path from "node:path";
import { ChromaClient } from "chromadb";
import matter from "gray-matter";
import { tool } from "@strands-agents/sdk";
import type { JSONValue } from "@strands-agents/sdk";
import { z } from "zod";
import type { Config } from "../config.ts";
import { HFEmbedding } from "../memory/ltm/embed.ts";
import { chromaClientArgsFromUrl } from "../memory/ltm/utils.ts";
import { getCwd } from "../utils/cwd-context.ts";

const WIKI_DIR = "wiki";
const PAGES_DIR = "pages";
const INDEX_FILE = "index.md";
const LOG_FILE = "log.md";
const SCHEMA_FILE = "schema.md";
const DEFAULT_SEARCH_LIMIT = 5;
const MAX_SEARCH_LIMIT = 20;

type PageFrontmatter = {
  title?: string;
  summary?: string;
  tags?: string[];
  related?: string[];
  type?: string;
  created?: string;
  updated?: string;
};

type PageRecord = {
  path: string;
  absolutePath: string;
  title: string;
  summary: string;
  tags: string[];
  related: string[];
  type: string | null;
  created: string | null;
  updated: string | null;
  wordCount: number;
  mtime: string;
  content: string;
  body: string;
  frontmatter: PageFrontmatter;
};

type Collection = Awaited<ReturnType<ChromaClient["getOrCreateCollection"]>>;

function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function wikiRoot(): string {
  return path.join(getCwd(), WIKI_DIR);
}

function stripLeadingSlashes(value: string): string {
  return value.replace(/^[/\\]+/, "");
}

function pageRelativePath(inputPath: string): string {
  const normalized = stripLeadingSlashes(inputPath.trim().replace(/\\/g, "/"));
  if (!normalized) {
    throw new Error("Page path is required.");
  }
  const withPrefix = normalized.startsWith(`${PAGES_DIR}/`)
    ? normalized
    : `${PAGES_DIR}/${normalized}`;
  if (!withPrefix.toLowerCase().endsWith(".md")) {
    throw new Error("Page paths must end with .md");
  }
  return withPrefix;
}

function resolveWithinRoot(root: string, relativePath: string): string {
  const abs = path.resolve(root, relativePath);
  const normalizedRoot = path.resolve(root);
  if (
    abs !== normalizedRoot &&
    !abs.startsWith(`${normalizedRoot}${path.sep}`) &&
    !(
      process.platform === "win32" &&
      abs.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}${path.sep}`)
    )
  ) {
    throw new Error(`Path escapes wiki root: ${relativePath}`);
  }
  return abs;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function firstSentence(value: string, maxLength: number = 180): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) {
    return "";
  }
  return clean.length > maxLength
    ? `${clean.slice(0, maxLength - 1).trimEnd()}…`
    : clean;
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseFrontmatter(content: string): {
  frontmatter: PageFrontmatter;
  body: string;
} {
  const parsed = matter(content);
  const data = parsed.data as Record<string, unknown>;
  return {
    frontmatter: {
      title: safeString(data.title) ?? undefined,
      summary: safeString(data.summary) ?? undefined,
      tags: safeStringArray(data.tags),
      related: safeStringArray(data.related),
      type: safeString(data.type) ?? undefined,
      created: safeString(data.created) ?? undefined,
      updated: safeString(data.updated) ?? undefined,
    },
    body: parsed.content.trim(),
  };
}

function wordCount(content: string): number {
  const words = content.trim().match(/\S+/g);
  return words ? words.length : 0;
}

function normalizeRelatedPath(value: string): string {
  let item = value.trim().replace(/\\/g, "/");
  item = item.replace(/^\[\[|\]\]$/g, "");
  item = stripLeadingSlashes(item);
  if (!item.endsWith(".md")) {
    item = `${item}.md`;
  }
  if (!item.startsWith(`${PAGES_DIR}/`)) {
    item = `${PAGES_DIR}/${item}`;
  }
  return item;
}

function deriveTitle(
  relativePath: string,
  frontmatter: PageFrontmatter,
): string {
  const fromFrontmatter = safeString(frontmatter.title);
  if (fromFrontmatter) {
    return fromFrontmatter;
  }
  return path.basename(relativePath, ".md").replace(/[-_]+/g, " ").trim();
}

function deriveSummary(
  frontmatter: PageFrontmatter,
  body: string,
  fallback: string,
): string {
  const fromFrontmatter = safeString(frontmatter.summary);
  if (fromFrontmatter) {
    return firstSentence(fromFrontmatter);
  }
  const bodySummary = firstSentence(body);
  return bodySummary || firstSentence(fallback) || "No summary available.";
}

async function readPageRecord(
  root: string,
  relativePath: string,
): Promise<PageRecord> {
  const absolutePath = resolveWithinRoot(root, relativePath);
  const content = await fs.readFile(absolutePath, "utf8");
  const stat = await fs.stat(absolutePath);
  const parsed = parseFrontmatter(content);
  const title = deriveTitle(relativePath, parsed.frontmatter);
  const summary = deriveSummary(parsed.frontmatter, parsed.body, title);
  return {
    path: relativePath.replace(/\\/g, "/"),
    absolutePath,
    title,
    summary,
    tags: parsed.frontmatter.tags ?? [],
    related: (parsed.frontmatter.related ?? []).map(normalizeRelatedPath),
    type: parsed.frontmatter.type ?? null,
    created: parsed.frontmatter.created ?? null,
    updated: parsed.frontmatter.updated ?? null,
    wordCount: wordCount(parsed.body),
    mtime: stat.mtime.toISOString(),
    content,
    body: parsed.body,
    frontmatter: parsed.frontmatter,
  };
}

async function listPagePaths(root: string): Promise<string[]> {
  const pagesRoot = resolveWithinRoot(root, PAGES_DIR);
  const out: string[] = [];

  const walk = async (dirPath: string): Promise<void> => {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
        continue;
      }
      const relFromRoot = path.relative(root, fullPath).replace(/\\/g, "/");
      out.push(relFromRoot);
    }
  };

  if (await fileExists(pagesRoot)) {
    await walk(pagesRoot);
  }

  out.sort((a, b) => a.localeCompare(b));
  return out;
}

async function listPages(root: string): Promise<PageRecord[]> {
  const paths = await listPagePaths(root);
  return Promise.all(
    paths.map((relativePath) => readPageRecord(root, relativePath)),
  );
}

function buildIndexMarkdown(pages: PageRecord[]): string {
  const sorted = [...pages].sort((a, b) => a.title.localeCompare(b.title));
  const lines: string[] = [
    "# Wiki Index",
    "",
    "<!-- Auto-generated by wiki_write_file. -->",
    "",
    `Updated: ${new Date().toISOString()}`,
    "",
    "## Pages",
  ];

  if (sorted.length === 0) {
    lines.push("- _No wiki pages yet._");
    return `${lines.join("\n")}\n`;
  }

  for (const page of sorted) {
    const tags = page.tags.length > 0 ? ` | tags: ${page.tags.join(", ")}` : "";
    lines.push(`- [${page.title}](${page.path}): ${page.summary}${tags}`);
  }

  return `${lines.join("\n")}\n`;
}

function buildLogEntry(
  operation: string,
  details: Record<string, string>,
): string {
  const lines: string[] = [
    `## [${new Date().toISOString()}] ${operation}`,
    ...Object.entries(details).map(([key, value]) => `- ${key}: ${value}`),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

const DEFAULT_SCHEMA = `# Wiki Schema

This wiki is maintained by the agent through wiki tools.

## Structure
- \`pages/\`: markdown knowledge pages
- \`index.md\`: derived index (tool-managed)
- \`log.md\`: append-only activity log (tool-managed)

## Page conventions
- Use markdown files under \`pages/\`
- Prefer concise titles and summaries
- Add frontmatter when helpful (\`title\`, \`summary\`, \`tags\`, \`related\`, \`type\`)
- Use relative links to other pages when appropriate
`;

async function ensureWikiLayout(root: string): Promise<void> {
  const pagesRoot = resolveWithinRoot(root, PAGES_DIR);
  await fs.mkdir(pagesRoot, { recursive: true });

  const indexPath = resolveWithinRoot(root, INDEX_FILE);
  const logPath = resolveWithinRoot(root, LOG_FILE);
  const schemaPath = resolveWithinRoot(root, SCHEMA_FILE);

  if (!(await fileExists(indexPath))) {
    await fs.writeFile(indexPath, buildIndexMarkdown([]), "utf8");
  }
  if (!(await fileExists(logPath))) {
    await fs.writeFile(logPath, "# Wiki Log\n\n", "utf8");
  }
  if (!(await fileExists(schemaPath))) {
    await fs.writeFile(schemaPath, `${DEFAULT_SCHEMA}\n`, "utf8");
  }
}

async function writeIndex(root: string, pages: PageRecord[]): Promise<void> {
  const indexPath = resolveWithinRoot(root, INDEX_FILE);
  await fs.writeFile(indexPath, buildIndexMarkdown(pages), "utf8");
}

async function appendLog(
  root: string,
  operation: string,
  details: Record<string, string>,
): Promise<void> {
  const logPath = resolveWithinRoot(root, LOG_FILE);
  await fs.appendFile(logPath, buildLogEntry(operation, details), "utf8");
}

function pageIndexId(relativePath: string): string {
  return `wiki:page:${relativePath}`;
}

function searchMetadata(page: PageRecord): Record<string, string | number> {
  return {
    kind: "page",
    path: page.path,
    title: page.title,
    summary: page.summary,
    tags: page.tags.join(","),
    word_count: page.wordCount,
  };
}

export function createWikiTools(config: Config) {
  const root = wikiRoot();
  const client = new ChromaClient({
    ...chromaClientArgsFromUrl(config.features.wiki.chroma.url),
  });
  let collectionPromise: Promise<Collection> | null = null;

  const collection = async (): Promise<Collection> => {
    if (!collectionPromise) {
      collectionPromise = client.getOrCreateCollection({
        name: config.features.wiki.chroma.collection.wiki,
        embeddingFunction: new HFEmbedding(),
      });
    }
    return collectionPromise;
  };

  const upsertPageSearch = async (page: PageRecord): Promise<void> => {
    const c = await collection();
    const id = pageIndexId(page.path);
    try {
      await c.delete({ ids: [id] });
    } catch {
      // best-effort cleanup
    }
    await c.add({
      ids: [id],
      documents: [page.body || page.content],
      metadatas: [searchMetadata(page)],
    });
  };

  return [
    tool({
      name: "wiki_list_files",
      description:
        "List wiki files by type. Supports `page` and returns frontmatter-aware summaries.",
      inputSchema: z.object({
        type: z.enum(["page"]).default("page"),
      }),
      callback: async () => {
        await ensureWikiLayout(root);
        const pages = await listPages(root);
        return toJsonValue({
          root,
          type: "page",
          count: pages.length,
          files: pages.map((page) => ({
            path: page.path,
            title: page.title,
            summary: page.summary,
            tags: page.tags,
            related: page.related,
            type: page.type,
            created: page.created,
            updated: page.updated,
            word_count: page.wordCount,
            modified_at: page.mtime,
          })),
        });
      },
    }),
    tool({
      name: "wiki_read_file",
      description:
        "Read wiki files. Kinds: index, log, schema, or a specific page.",
      inputSchema: z.object({
        kind: z.enum(["index", "log", "schema", "page"]),
        path: z.string().optional(),
      }),
      callback: async (input) => {
        await ensureWikiLayout(root);

        if (input.kind === "page") {
          if (!input.path) {
            throw new Error("`path` is required when kind is `page`.");
          }
          const relativePath = pageRelativePath(input.path);
          const page = await readPageRecord(root, relativePath);
          return toJsonValue({
            root,
            kind: input.kind,
            path: page.path,
            frontmatter: page.frontmatter,
            title: page.title,
            summary: page.summary,
            word_count: page.wordCount,
            content: page.content,
          });
        }

        if (input.path) {
          throw new Error(
            "`path` is only valid when kind is `page` and should be omitted otherwise.",
          );
        }

        const target =
          input.kind === "index"
            ? INDEX_FILE
            : input.kind === "log"
              ? LOG_FILE
              : SCHEMA_FILE;
        const absolutePath = resolveWithinRoot(root, target);
        const content = await fs.readFile(absolutePath, "utf8");
        return toJsonValue({
          root,
          kind: input.kind,
          path: target,
          content,
        });
      },
    }),
    tool({
      name: "wiki_write_file",
      description:
        "Write wiki files. Page writes automatically maintain index, log, and search index.",
      inputSchema: z.object({
        kind: z.enum(["page", "schema"]),
        path: z.string().optional(),
        content: z.string().min(1),
      }),
      callback: async (input) => {
        await ensureWikiLayout(root);
        const content = input.content;

        if (input.kind === "schema") {
          if (input.path) {
            throw new Error("`path` is not valid when kind is `schema`.");
          }
          const schemaPath = resolveWithinRoot(root, SCHEMA_FILE);
          await fs.writeFile(schemaPath, content, "utf8");
          await appendLog(root, "schema_update", { path: SCHEMA_FILE });
          return toJsonValue({
            root,
            kind: input.kind,
            path: SCHEMA_FILE,
            bytes_written: Buffer.byteLength(content, "utf8"),
            index_updated: false,
            log_updated: true,
            search_index_updated: false,
          });
        }

        if (!input.path) {
          throw new Error("`path` is required when kind is `page`.");
        }
        const relativePath = pageRelativePath(input.path);
        const absolutePath = resolveWithinRoot(root, relativePath);
        const existed = await fileExists(absolutePath);

        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, content, "utf8");

        const page = await readPageRecord(root, relativePath);
        await upsertPageSearch(page);

        const pages = await listPages(root);
        await writeIndex(root, pages);
        await appendLog(root, existed ? "page_update" : "page_create", {
          path: page.path,
          title: page.title,
        });

        return toJsonValue({
          root,
          kind: input.kind,
          path: page.path,
          title: page.title,
          summary: page.summary,
          bytes_written: Buffer.byteLength(content, "utf8"),
          index_updated: true,
          log_updated: true,
          search_index_updated: true,
        });
      },
    }),
    tool({
      name: "wiki_knowledge_graph",
      description:
        "Build the wiki knowledge graph from page frontmatter links and shared tags.",
      inputSchema: z.object({}),
      callback: async () => {
        await ensureWikiLayout(root);
        const pages = await listPages(root);
        const nodes = pages.map((page) => ({
          path: page.path,
          title: page.title,
          tags: page.tags,
          type: page.type ?? "page",
          word_count: page.wordCount,
        }));

        const edges: Array<{
          source: string;
          target: string;
          type: "related" | "shared-tag";
          tag?: string;
        }> = [];
        const inbound = new Map<string, number>();
        const relatedOut = new Map<string, number>();

        for (const page of pages) {
          relatedOut.set(page.path, page.related.length);
          for (const related of page.related) {
            edges.push({
              source: page.path,
              target: related,
              type: "related",
            });
            inbound.set(related, (inbound.get(related) ?? 0) + 1);
          }
        }

        const tagClusters = new Map<string, string[]>();
        for (const page of pages) {
          for (const tag of page.tags) {
            if (!tagClusters.has(tag)) {
              tagClusters.set(tag, []);
            }
            tagClusters.get(tag)!.push(page.path);
          }
        }

        for (const [tag, members] of tagClusters.entries()) {
          if (members.length < 2) {
            continue;
          }
          for (let i = 0; i < members.length; i += 1) {
            for (let j = i + 1; j < members.length; j += 1) {
              const source = members[i]!;
              const target = members[j]!;
              edges.push({ source, target, type: "shared-tag", tag });
            }
          }
        }

        const orphans = pages.filter((page) => {
          const incoming = inbound.get(page.path) ?? 0;
          const outgoing = relatedOut.get(page.path) ?? 0;
          return incoming === 0 && outgoing === 0;
        });

        return toJsonValue({
          nodes,
          edges,
          tag_clusters: Object.fromEntries(tagClusters.entries()),
          stats: {
            pages: pages.length,
            links: edges.length,
            orphans: orphans.length,
          },
        });
      },
    }),
    tool({
      name: "wiki_stats",
      description: "Return wiki health and usage statistics for page content.",
      inputSchema: z.object({}),
      callback: async () => {
        await ensureWikiLayout(root);
        const pages = await listPages(root);
        const totalWords = pages.reduce((sum, page) => sum + page.wordCount, 0);
        const tags = new Set<string>();
        const types: Record<string, number> = {};
        const inbound = new Map<string, number>();
        for (const page of pages) {
          for (const tag of page.tags) {
            tags.add(tag);
          }
          const type = page.type ?? "page";
          types[type] = (types[type] ?? 0) + 1;
          for (const related of page.related) {
            inbound.set(related, (inbound.get(related) ?? 0) + 1);
          }
        }
        const orphans = pages.filter(
          (page) =>
            (inbound.get(page.path) ?? 0) === 0 && page.related.length === 0,
        );
        const lastActivity = pages
          .map((page) => page.mtime)
          .sort()
          .at(-1);

        return toJsonValue({
          pages: pages.length,
          links: pages.reduce((sum, page) => sum + page.related.length, 0),
          orphans: orphans.length,
          total_words: totalWords,
          avg_words_per_page: pages.length > 0 ? totalWords / pages.length : 0,
          tags: tags.size,
          types,
          last_activity: lastActivity ?? null,
        });
      },
    }),
    tool({
      name: "wiki_search",
      description:
        "Semantic search over indexed wiki pages using the configured wiki Chroma collection.",
      inputSchema: z.object({
        query: z.string().min(1),
        k: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional(),
      }),
      callback: async (input) => {
        await ensureWikiLayout(root);
        const c = await collection();
        const result = await c.query<Record<string, string | number>>({
          queryTexts: [input.query],
          nResults: input.k ?? DEFAULT_SEARCH_LIMIT,
          include: ["documents", "metadatas", "distances"],
        });

        const rows = result.rows()[0] ?? [];
        const matches = rows
          .filter(
            (
              row,
            ): row is (typeof rows)[number] & {
              document: string;
              metadata: Record<string, string | number>;
            } => typeof row.document === "string" && !!row.metadata,
          )
          .map((row) => ({
            id: row.id,
            path:
              typeof row.metadata.path === "string" ? row.metadata.path : null,
            title:
              typeof row.metadata.title === "string"
                ? row.metadata.title
                : null,
            summary:
              typeof row.metadata.summary === "string"
                ? row.metadata.summary
                : null,
            tags:
              typeof row.metadata.tags === "string" ? row.metadata.tags : "",
            distance: row.distance ?? null,
            content: row.document,
          }));

        return toJsonValue({
          query: input.query,
          count: matches.length,
          matches,
        });
      },
    }),
  ];
}
