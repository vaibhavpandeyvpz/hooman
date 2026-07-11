/**
 * Screenshot-backed Figma Design (.fig) and Slides (.deck) writers.
 * Same idea as PPTX: one full-bleed image per frame / slide.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEmptyFigDoc,
  parseFig,
  type FigDocument,
  type FigNode,
} from "openfig-core";
import type { RenderedPage } from "./export-design.js";
import {
  createPlaceholderThumbnail,
  encodeFigArchive,
  FIG_BASE,
  figImagePaint,
  IDENTITY,
  maxLocalId,
  rebuildFigMaps,
  siblingPosition,
} from "./fig-archive.js";

const FIGMA_SLIDES_WIDTH = 1920;
const FIGMA_SLIDES_HEIGHT = 1080;
const FRAME_GAP = 80;

function seedDeckPath(): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    "seeds",
    "empty-slides.deck",
  );
}

function ensureMessageEnvelope(doc: FigDocument): void {
  const msg = doc.message as FigDocument["message"] & {
    sessionID?: number;
    ackID?: number;
    blobs?: unknown[];
  };
  msg.sessionID = msg.sessionID ?? 0;
  msg.ackID = msg.ackID ?? 0;
  msg.blobs = msg.blobs ?? [];
}

async function loadEmptyDeckDoc(title: string): Promise<FigDocument> {
  const path = seedDeckPath();
  if (!existsSync(path)) {
    throw new Error(
      `Missing Figma Slides seed at ${path}. Rebuild with copy-bundled-assets.`,
    );
  }
  const doc = await parseFig(readFileSync(path));
  doc.header = { ...doc.header, prelude: "fig-deck" };
  ensureMessageEnvelope(doc);
  doc.meta = {
    ...(doc.meta ?? {}),
    file_name: title,
  };
  doc.thumbnail = createPlaceholderThumbnail();
  if (!doc.images) {
    doc.images = new Map();
  }
  rebuildFigMaps(doc);
  return doc;
}

/**
 * Screenshot pages → simple Design `.fig` (one frame per page, image fill).
 */
export async function buildScreenshotFig(
  images: RenderedPage[],
  opts: { title?: string } = {},
): Promise<Buffer> {
  if (images.length === 0) {
    throw new Error("no pages to export");
  }
  const title = opts.title ?? "Untitled";
  const doc = createEmptyFigDoc();
  ensureMessageEnvelope(doc);
  doc.meta = { file_name: title, version: 0 };
  doc.thumbnail = createPlaceholderThumbnail();
  doc.images = new Map();

  const pageGuid = { sessionID: 0, localID: 1 };
  let nextLocal = maxLocalId(doc) + 1;
  let offsetX = 0;

  for (let i = 0; i < images.length; i++) {
    const img = images[i]!;
    const paint = figImagePaint(
      doc,
      new Uint8Array(img.buffer),
      img.width,
      img.height,
    );
    doc.message.nodeChanges.push({
      ...FIG_BASE,
      guid: { sessionID: 1, localID: nextLocal++ },
      type: "FRAME",
      name: images.length === 1 ? title : `Page ${i + 1}`,
      parentIndex: { guid: pageGuid, position: siblingPosition(i) },
      size: { x: img.width, y: img.height },
      transform: { ...IDENTITY, m02: offsetX, m12: 0 },
      fillPaints: [paint],
      frameMaskDisabled: false,
      proportionsConstrained: true,
    } as never);
    offsetX += img.width + FRAME_GAP;
  }

  rebuildFigMaps(doc);
  const bytes = await encodeFigArchive(doc, {
    prelude: "fig-kiwi",
    fileName: title,
    thumbnail: doc.thumbnail,
  });
  return Buffer.from(bytes);
}

/**
 * Screenshot pages → simple Slides `.deck` (one slide per page, full-bleed image).
 */
export async function buildScreenshotDeck(
  images: RenderedPage[],
  opts: { title?: string } = {},
): Promise<Buffer> {
  if (images.length === 0) {
    throw new Error("no slides to export");
  }
  const title = opts.title ?? "Untitled";
  const doc = await loadEmptyDeckDoc(title);
  const slideW = FIGMA_SLIDES_WIDTH;
  const slideH = FIGMA_SLIDES_HEIGHT;
  const gridPadding = 240;
  const rowGap = slideW + 240;

  let nodes: FigNode[] = doc.message.nodeChanges;
  const row = nodes.find((n: FigNode) => n.type === "SLIDE_ROW");
  if (!row) {
    throw new Error("buildScreenshotDeck: seed missing SLIDE_ROW");
  }
  const rowGuid = { ...row.guid };
  const placeholder = nodes.find((n: FigNode) => n.type === "SLIDE");
  const themeID = placeholder?.themeID;
  const sourceLibraryKey = placeholder?.sourceLibraryKey;
  const placeholderKey = placeholder
    ? `${placeholder.guid.sessionID}:${placeholder.guid.localID}`
    : null;

  if (placeholderKey) {
    const [ps, pl] = placeholderKey.split(":").map(Number) as [number, number];
    nodes = nodes.filter(
      (n: FigNode) =>
        !(n.guid.sessionID === ps && n.guid.localID === pl) &&
        !(
          n.parentIndex?.guid?.sessionID === ps &&
          n.parentIndex?.guid?.localID === pl
        ),
    );
    doc.message.nodeChanges = nodes;
  }

  const slideCount = images.length;
  const gridW = slideCount * slideW + (slideCount - 1) * 240 + gridPadding * 2;
  const gridH = slideH + gridPadding * 2;
  const grid = nodes.find((n: FigNode) => n.type === "SLIDE_GRID");
  if (grid) {
    grid.size = { x: gridW, y: gridH };
  }
  row.size = {
    x: slideCount * slideW + (slideCount - 1) * 240,
    y: slideH,
  };
  if (doc.meta && typeof doc.meta === "object") {
    const meta = doc.meta as Record<string, unknown>;
    const clientMeta = meta.client_meta as
      { render_coordinates?: Record<string, number> } | undefined;
    if (clientMeta?.render_coordinates) {
      clientMeta.render_coordinates = {
        x: 0,
        y: 0,
        width: gridW,
        height: gridH,
      };
    }
    meta.file_name = title;
  }

  let nextLocal = maxLocalId(doc) + 1;
  for (let i = 0; i < images.length; i++) {
    const img = images[i]!;
    const slideGuid = { sessionID: 1, localID: nextLocal++ };
    const imageGuid = { sessionID: 1, localID: nextLocal++ };
    const paint = figImagePaint(
      doc,
      new Uint8Array(img.buffer),
      img.width,
      img.height,
    );

    nodes.push({
      ...FIG_BASE,
      guid: slideGuid,
      type: "SLIDE",
      name: String(i + 1),
      parentIndex: { guid: rowGuid, position: siblingPosition(i) },
      size: { x: slideW, y: slideH },
      transform: { ...IDENTITY, m02: i * rowGap },
      strokeWeight: 1,
      strokeAlign: "INSIDE",
      strokeJoin: "MITER",
      fillPaints: [
        {
          type: "SOLID",
          color: { r: 1, g: 1, b: 1, a: 1 },
          opacity: 1,
          visible: true,
          blendMode: "NORMAL",
        },
      ],
      frameMaskDisabled: false,
      themeID,
      sourceLibraryKey,
    } as never);

    nodes.push({
      ...FIG_BASE,
      guid: imageGuid,
      type: "ROUNDED_RECTANGLE",
      name: "Screenshot",
      parentIndex: { guid: slideGuid, position: "!" },
      size: { x: slideW, y: slideH },
      transform: { ...IDENTITY },
      proportionsConstrained: true,
      fillPaints: [{ ...paint, imageScaleMode: "FILL" }],
    } as never);
  }

  rebuildFigMaps(doc);
  const bytes = await encodeFigArchive(doc, {
    prelude: "fig-deck",
    fileName: title,
    thumbnail: doc.thumbnail ?? createPlaceholderThumbnail(),
    includeImagesDir: true,
  });
  return Buffer.from(bytes);
}
