import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_EMBED_MODEL } from "../config.js";
import { embed, GgufEmbedder, rerank } from "../inference/index.js";
import { modelsCachePath, wikiDbPath, wikiPath } from "../utils/paths.js";
import {
  convertFileToMarkdown,
  type ConvertFileOptions,
} from "./converters.js";
import {
  Database,
  type WikiDocRecord,
  type WikiSearchRow,
} from "./database.js";

const RAW_DIR = "raw";
const PAGES_DIR = "pages";
const MAX_CHUNK_CHARS = 2400;
const VEC_K_MULTIPLIER = 5;

export type WikiListResult = {
  page: number;
  pageSize: number;
  items: WikiDocRecord[];
};

export type WikiSearchMatch = {
  id: string;
  file_name: string;
  md_file_path: string;
  original_file_path: string;
  original_mime_type: string;
  chunk_pos: number;
  content: string;
  distance: number | null;
  score: number | null;
  source: "vec";
};

export type WikiAddInput = Omit<ConvertFileOptions, "filePath"> & {
  filePath: string;
};

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function fileHash(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function chunkMarkdown(body: string): string[] {
  const trimmed = body.trim();
  if (!trimmed) {
    return [""];
  }
  const paragraphs = trimmed
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const p of paragraphs) {
    if (cur.length + p.length + 2 <= MAX_CHUNK_CHARS) {
      cur = cur ? `${cur}\n\n${p}` : p;
      continue;
    }
    if (cur) {
      out.push(cur);
    }
    if (p.length > MAX_CHUNK_CHARS) {
      for (let i = 0; i < p.length; i += MAX_CHUNK_CHARS) {
        out.push(p.slice(i, i + MAX_CHUNK_CHARS));
      }
      cur = "";
    } else {
      cur = p;
    }
  }
  if (cur) {
    out.push(cur);
  }
  return out.length > 0 ? out : [""];
}

function safeFileStem(inputName: string): string {
  return inputName.replace(/[^\w.-]+/g, "_");
}

function buildChunkId(docId: string, index: number, hash: string): string {
  return crypto
    .createHash("sha256")
    .update(`${docId}\0${index}\0${hash}`, "utf8")
    .digest("hex");
}

function toSearchMatch(
  row: WikiSearchRow,
  distance: number | undefined,
): WikiSearchMatch {
  const dist =
    typeof distance === "number" && Number.isFinite(distance) ? distance : null;
  return {
    id: row.chunk_id,
    file_name: row.file_name,
    md_file_path: row.md_path,
    original_file_path: row.original_path,
    original_mime_type: row.original_mime_type,
    chunk_pos: row.chunk_index,
    content: row.content,
    distance: dist,
    score: dist == null ? null : Math.max(0, Math.min(1, 1 - dist)),
    source: "vec",
  };
}

export class Storage {
  private constructor(
    private readonly root: string,
    private readonly db: Database,
    private readonly embedder: GgufEmbedder,
  ) {}

  public static create(): Storage {
    const root = wikiPath();
    const db = new Database(wikiDbPath());
    const embedder = new GgufEmbedder({
      modelUri: DEFAULT_EMBED_MODEL,
      cacheDir: modelsCachePath(),
    });
    return new Storage(root, db, embedder);
  }

  public async warmup(): Promise<void> {
    await this.embedder.warmup();
    await fs.mkdir(path.join(this.root, RAW_DIR), { recursive: true });
    await fs.mkdir(path.join(this.root, PAGES_DIR), { recursive: true });
  }

  public async list(
    page: number = 1,
    pageSize: number = 20,
  ): Promise<WikiListResult> {
    const p = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const ps =
      Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 20;
    return {
      page: p,
      pageSize: ps,
      items: this.db.listDocs(p, ps),
    };
  }

  public async add(input: WikiAddInput): Promise<WikiDocRecord> {
    const converted = await convertFileToMarkdown({
      ...input,
      filePath: input.filePath,
    });
    const now = Date.now();
    const docId = crypto.randomUUID();

    const sourceExt = path.extname(converted.originalPath).toLowerCase();
    const sourceName = safeFileStem(path.basename(converted.originalPath));
    const mdStem = safeFileStem(path.basename(sourceName, sourceExt));
    const rawAbs = path.resolve(this.root, RAW_DIR, `${docId}-${sourceName}`);
    const mdAbs = path.resolve(this.root, PAGES_DIR, `${docId}-${mdStem}.md`);

    await fs.copyFile(converted.originalPath, rawAbs);
    const markdown = normalizeText(converted.markdown);
    await fs.writeFile(mdAbs, markdown, "utf8");

    const hash = fileHash(markdown);
    const existing = this.db.getDocByOriginalPath(rawAbs);
    if (existing) {
      this.db.removeDoc(existing.doc_id);
    }

    const chunks = chunkMarkdown(markdown);
    const embeddings: Float32Array[] = [];
    const rows: Array<{
      chunk_id: string;
      chunk_index: number;
      content: string;
    }> = [];
    for (let i = 0; i < chunks.length; i += 1) {
      const text = chunks[i]!;
      const chunkId = buildChunkId(docId, i, hash);
      const embedding = await this.embedder.embedDocument(
        text,
        converted.fileName,
      );
      this.db.prepare(this.embedder.resolvedModelUri, embedding.length);
      embeddings.push(embedding);
      rows.push({ chunk_id: chunkId, chunk_index: i, content: text });
    }

    const doc: WikiDocRecord = {
      doc_id: docId,
      file_name: converted.fileName,
      md_path: mdAbs,
      original_path: rawAbs,
      original_mime_type: converted.mimeType,
      content_hash: hash,
      updated_at_ms: now,
    };
    this.db.addDocAndChunks(doc, rows, embeddings);
    return doc;
  }

  public async remove(id: string): Promise<boolean> {
    const doc = this.db.getDocById(id);
    if (!doc) {
      return false;
    }
    this.db.removeDoc(id);
    await fs.rm(doc.md_path, { force: true }).catch(() => undefined);
    await fs.rm(doc.original_path, { force: true }).catch(() => undefined);
    return true;
  }

  public async search(q: string, k: number = 5): Promise<WikiSearchMatch[]> {
    const query = q.trim();
    if (!query) {
      return [];
    }
    await this.embedder.warmup();
    const queryEmbedding = Float32Array.from(
      await embed(this.embedder, query, "query"),
    );
    this.db.prepare(this.embedder.resolvedModelUri, queryEmbedding.length);

    const limit = Number.isFinite(k) && k > 0 ? Math.floor(k) : 5;
    const vecHits = this.db.vectorSearch(
      queryEmbedding,
      Math.max(1, limit * VEC_K_MULTIPLIER),
    );
    if (vecHits.length === 0) {
      return [];
    }

    const orderedIds = vecHits.map((h) => h.chunk_id);
    const distanceById = new Map(vecHits.map((h) => [h.chunk_id, h.distance]));
    const rows = this.db.getSearchRowsByChunkIds(orderedIds);
    const rowById = new Map(rows.map((r) => [r.chunk_id, r]));
    const ordered = orderedIds
      .map((id) => {
        const row = rowById.get(id);
        if (!row) {
          return null;
        }
        return toSearchMatch(row, distanceById.get(id));
      })
      .filter((x): x is WikiSearchMatch => x != null);
    const ranked = rerank(query, ordered);
    return ranked.slice(0, limit);
  }

  public async close(): Promise<void> {
    await this.embedder.dispose();
    this.db.close();
  }
}
