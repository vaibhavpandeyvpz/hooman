import fs from "node:fs/promises";
import path from "node:path";
import type { SearchResult } from "@tobilu/qmd";
import { tool } from "@strands-agents/sdk";
import type { JSONValue } from "@strands-agents/sdk";
import { z } from "zod";
import {
  DEFAULT_SEARCH_LIMIT,
  INDEX_FILE,
  LOG_FILE,
  MAX_SEARCH_LIMIT,
  QMD_COLLECTION,
  SCHEMA_FILE,
  WikiStore,
} from "./store.js";

function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function mapVectorChunkToMatch(row: SearchResult, root: string, index: number) {
  const relPath = path.relative(root, row.filepath).replace(/\\/g, "/");
  const distance =
    typeof row.score === "number" && Number.isFinite(row.score)
      ? Math.max(0, 1 - row.score)
      : null;
  const id =
    row.chunkPos != null
      ? `${row.docid}:${row.chunkPos}`
      : `${row.docid}:${index}`;
  return {
    id,
    path: relPath,
    title: row.title,
    summary: row.context,
    tags: "",
    distance,
    score: row.score,
    source: row.source,
    chunk_pos: row.chunkPos ?? null,
    content: row.body ?? "",
  };
}

export function createWikiTools(wiki: WikiStore) {
  const { root } = wiki;

  return [
    tool({
      name: "wiki_list_files",
      description:
        "List wiki files by type. Supports `page` and returns frontmatter-aware summaries.",
      inputSchema: z.object({
        type: z.enum(["page"]).default("page"),
      }),
      callback: async () => {
        await wiki.ensureLayout();
        const pages = await wiki.listPages();
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
        await wiki.ensureLayout();

        if (input.kind === "page") {
          if (!input.path) {
            throw new Error("`path` is required when kind is `page`.");
          }
          const relativePath = wiki.pageRelativePath(input.path);
          const page = await wiki.readPage(relativePath);
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
        const absolutePath = wiki.resolveWithin(target);
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
        await wiki.ensureLayout();
        const content = input.content;

        if (input.kind === "schema") {
          if (input.path) {
            throw new Error("`path` is not valid when kind is `schema`.");
          }
          const schemaPath = wiki.resolveWithin(SCHEMA_FILE);
          await fs.writeFile(schemaPath, content, "utf8");
          await wiki.appendLog("schema_update", { path: SCHEMA_FILE });
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
        const relativePath = wiki.pageRelativePath(input.path);
        const absolutePath = wiki.resolveWithin(relativePath);
        const existed = await wiki.pathExists(absolutePath);

        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, content, "utf8");

        const page = await wiki.readPage(relativePath);
        await wiki.syncSearchIndex();

        const pages = await wiki.listPages();
        await wiki.writeIndex(pages);
        await wiki.appendLog(existed ? "page_update" : "page_create", {
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
        await wiki.ensureLayout();
        const pages = await wiki.listPages();
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
        await wiki.ensureLayout();
        const pages = await wiki.listPages();
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
        "Semantic search over wiki chunks (QMD index under $HOOMAN_HOME/wiki/.qmd/index.sqlite). Returns matching snippets; use wiki_read_file on paths you need in full.",
      inputSchema: z.object({
        query: z.string().min(1),
        k: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional(),
      }),
      callback: async (input) => {
        await wiki.ensureLayout();
        const store = await wiki.qmdStore();
        const k = input.k ?? DEFAULT_SEARCH_LIMIT;
        const rows = await store.searchVector(input.query, {
          limit: k,
          collection: QMD_COLLECTION,
        });
        const matches = rows.map((row, index) =>
          mapVectorChunkToMatch(row, root, index),
        );

        return toJsonValue({
          query: input.query,
          count: matches.length,
          matches,
        });
      },
    }),
  ];
}
