import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import type { ContentBlock } from "@agentclientprotocol/sdk";

const MAX_ATTACHMENT_BYTES = 1024 * 1024;

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const AUDIO_MIME_BY_EXT: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
};

/**
 * Converts local channel attachment paths into ACP `session/prompt` content
 * blocks: recognized image/audio files under the 1 MiB limit are embedded as
 * base64 `image`/`audio` blocks, everything else (including oversized or
 * unreadable files) is listed as a text block naming the local absolute
 * path, since the ACP agent runs on the same machine and can read it itself.
 */
export async function attachmentPathsToAcpBlocks(
  paths: readonly string[],
): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [];
  const textPaths: string[] = [];
  for (const rawPath of paths) {
    const path = rawPath.trim();
    if (!path) {
      continue;
    }
    const ext = extname(path).toLowerCase();
    const imageMime = IMAGE_MIME_BY_EXT[ext];
    const audioMime = AUDIO_MIME_BY_EXT[ext];
    if (!imageMime && !audioMime) {
      textPaths.push(path);
      continue;
    }
    try {
      const info = await stat(path);
      if (!info.isFile() || info.size > MAX_ATTACHMENT_BYTES) {
        textPaths.push(path);
        continue;
      }
      const data = (await readFile(path)).toString("base64");
      blocks.push(
        imageMime
          ? { type: "image", data, mimeType: imageMime }
          : { type: "audio", data, mimeType: audioMime! },
      );
    } catch {
      textPaths.push(path);
    }
  }
  if (textPaths.length > 0) {
    blocks.push({
      type: "text",
      text: `Files uploaded:\n${textPaths.join("\n")}`,
    });
  }
  return blocks;
}
