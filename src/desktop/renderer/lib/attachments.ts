import type { PromptContentBlock } from "../../shared/session-types.js";

export type ComposerAttachment = {
  id: string;
  name: string;
  mimeType?: string;
  kind: "image" | "file" | "directory";
  block: PromptContentBlock;
};

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Encodes a dropped/pasted/picked `File` into an ACP prompt content block. Images use the `image` block; anything else uses an embedded `resource` blob. */
export async function fileToAttachment(
  file: File,
): Promise<ComposerAttachment> {
  const base64 = bytesToBase64(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";
  const isImage = mimeType.startsWith("image/");
  const id = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id,
    name: file.name || "attachment",
    mimeType,
    kind: isImage ? "image" : "file",
    block: isImage
      ? { type: "image", data: base64, mimeType }
      : {
          type: "resource",
          resource: {
            uri: `attachment://${file.name}`,
            mimeType,
            blob: base64,
          },
        },
  };
}

/**
 * Wraps a native-dialog-picked file/directory (`window.hooman.pickFiles`) as
 * a path-by-reference attachment — mirrors the VS Code webview's
 * `resource_link` attachments: the agent gets the path, not its bytes, so
 * folders and arbitrarily large files are fine to attach.
 */
export function pathToAttachment(entry: {
  uri: string;
  name: string;
  kind: "file" | "directory";
  size?: number;
}): ComposerAttachment {
  return {
    id: `${entry.uri}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: entry.name,
    kind: entry.kind,
    block: {
      type: "resource_link",
      uri: entry.uri,
      name: entry.name,
      size: entry.size,
    },
  };
}
