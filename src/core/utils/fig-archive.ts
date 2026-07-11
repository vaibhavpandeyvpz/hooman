/**
 * Encode openfig FigDocument → .fig / .deck ZIP bytes.
 */

import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { zipSync } from "fflate";
import {
  assembleCanvasFig,
  encodeFigParts,
  type FigDocument,
} from "openfig-core";
import { zstdCompress } from "./zstd.js";

export const IDENTITY = {
  m00: 1,
  m01: 0,
  m02: 0,
  m10: 0,
  m11: 1,
  m12: 0,
} as const;

export const FIG_BASE = {
  phase: "CREATED",
  visible: true,
  opacity: 1,
  strokeWeight: 0,
  strokeAlign: "CENTER",
  strokeJoin: "BEVEL",
  transform: { ...IDENTITY },
} as const;

export type EncodeArchiveOptions = {
  prelude?: string;
  meta?: Record<string, unknown>;
  thumbnail?: Uint8Array;
  fileName?: string;
  includeImagesDir?: boolean;
};

/** Minimal solid PNG for archive thumbnail.png. */
export function createPlaceholderThumbnail(
  width = 400,
  height = 260,
): Uint8Array {
  const row = Buffer.alloc(1 + width * 3, 0xff);
  row[0] = 0;
  const raw = Buffer.alloc(height * row.length);
  for (let i = 0; i < height; i++) {
    row.copy(raw, i * row.length);
  }
  const idat = deflateSync(raw);
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) {
      c = (crcTable[(c ^ b) & 0xff]! ^ (c >>> 8)) >>> 0;
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return new Uint8Array(
    Buffer.concat([
      sig,
      chunk("IHDR", ihdr),
      chunk("IDAT", idat),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

/** Fractional index positions: '!', '"', '#', ... */
export function siblingPosition(index: number): string {
  return String.fromCharCode(0x21 + (index % 90));
}

export function rebuildFigMaps(doc: FigDocument): void {
  doc.nodeMap = new Map();
  doc.childrenMap = new Map();
  for (const node of doc.message.nodeChanges) {
    const id = `${node.guid.sessionID}:${node.guid.localID}`;
    doc.nodeMap.set(id, node);
  }
  for (const node of doc.message.nodeChanges) {
    if (!node.parentIndex?.guid) {
      continue;
    }
    const pid = `${node.parentIndex.guid.sessionID}:${node.parentIndex.guid.localID}`;
    if (!doc.childrenMap.has(pid)) {
      doc.childrenMap.set(pid, []);
    }
    doc.childrenMap.get(pid)!.push(node);
  }
  doc.nodes = doc.message.nodeChanges;
}

export function maxLocalId(doc: FigDocument): number {
  let max = 0;
  for (const node of doc.message.nodeChanges) {
    if (node.guid?.localID > max) {
      max = node.guid.localID;
    }
  }
  return max;
}

/** Store image bytes on the doc and return an IMAGE fill paint. */
export function figImagePaint(
  doc: FigDocument,
  bytes: Uint8Array,
  width: number,
  height: number,
): Record<string, unknown> {
  const hashHex = createHash("sha1").update(bytes).digest("hex");
  const hashBytes = Uint8Array.from(Buffer.from(hashHex, "hex"));
  if (!doc.images) {
    doc.images = new Map();
  }
  doc.images.set(hashHex, bytes);
  return {
    type: "IMAGE",
    opacity: 1,
    visible: true,
    blendMode: "NORMAL",
    transform: { ...IDENTITY },
    image: { hash: hashBytes, name: hashHex },
    // Same asset as thumbnail — Figma accepts this for freestanding images.
    imageThumbnail: { hash: hashBytes, name: hashHex },
    imageScaleMode: "FILL",
    scale: 0.5,
    originalImageWidth: width,
    originalImageHeight: height,
    thumbHash: new Uint8Array(0),
    altText: "",
  };
}

/**
 * Encode document → ZIP archive bytes (canvas.fig + meta.json + thumbnail.png).
 */
export async function encodeFigArchive(
  doc: FigDocument,
  options: EncodeArchiveOptions = {},
): Promise<Uint8Array> {
  if (options.prelude) {
    doc.header = { ...doc.header, prelude: options.prelude };
  }

  const msg = doc.message as FigDocument["message"] & {
    sessionID?: number;
    ackID?: number;
    blobs?: unknown[];
  };
  if (msg.sessionID === undefined) {
    msg.sessionID = 0;
  }
  if (msg.ackID === undefined) {
    msg.ackID = 0;
  }
  if (!msg.blobs) {
    msg.blobs = [];
  }

  const parts = encodeFigParts(doc);
  const messageCompressed = await zstdCompress(parts.messageRaw, 3);
  const canvasFig = assembleCanvasFig({
    prelude: options.prelude ?? parts.prelude,
    version: parts.version,
    schemaCompressed: parts.schemaCompressed,
    messageCompressed,
    passThrough: parts.passThrough,
  });

  const meta =
    options.meta ??
    doc.meta ??
    ({
      file_name: options.fileName ?? "Untitled",
      version: 0,
    } as Record<string, unknown>);

  const thumbnail = options.thumbnail ?? doc.thumbnail;
  if (!thumbnail) {
    throw new Error(
      "encodeFigArchive: thumbnail.png is required for Figma import",
    );
  }

  const isDeck = (options.prelude ?? parts.prelude) === "fig-deck";
  const includeImagesDir = options.includeImagesDir ?? isDeck;

  const entries: Record<string, [Uint8Array, { level: 0 }]> = {
    "canvas.fig": [canvasFig, { level: 0 }],
    "meta.json": [new TextEncoder().encode(JSON.stringify(meta)), { level: 0 }],
    "thumbnail.png": [thumbnail, { level: 0 }],
  };

  if (includeImagesDir) {
    entries["images/"] = [new Uint8Array(0), { level: 0 }];
  }

  if (doc.images) {
    for (const [name, data] of doc.images) {
      entries[`images/${name}`] = [data, { level: 0 }];
    }
  }

  return zipSync(entries);
}
