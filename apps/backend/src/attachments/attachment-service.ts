import type { AttachmentStore, AttachmentDoc } from "./attachment-store.js";
import type { SavedAttachment } from "../types.js";

export interface AttachmentService {
  saveAll(
    userId: string,
    files: Array<{ buffer: Buffer; originalname: string; mimetype: string }>,
  ): Promise<SavedAttachment[]>;
  getAttachmentDoc(id: string, userId: string): Promise<AttachmentDoc | null>;
  getAttachmentBuffer(id: string, userId: string): Promise<Buffer | null>;
  /** Full path to stored file, or null. */
  getPath(id: string, userId: string): Promise<string | null>;
  /** Resolve ids to SavedAttachment[] (for payload). */
  getSavedAttachments(
    ids: string[],
    userId: string,
  ): Promise<SavedAttachment[]>;
}

export function createAttachmentService(
  store: AttachmentStore,
): AttachmentService {
  return {
    async saveAll(userId, files) {
      return Promise.all(
        files.map((f) =>
          store.save(userId, {
            buffer: f.buffer,
            originalname: f.originalname,
            mimetype: f.mimetype || "application/octet-stream",
          }),
        ),
      );
    },

    async getAttachmentDoc(id, userId) {
      return store.getById(id, userId);
    },

    async getAttachmentBuffer(id, userId) {
      return store.getBuffer(id, userId);
    },

    async getPath(id, userId) {
      return store.getPath(id, userId);
    },

    async getSavedAttachments(ids, userId) {
      const resolved = await Promise.all(
        ids.map(async (id) => {
          const doc = await store.getById(id, userId);
          if (!doc) return null;
          return {
            id: doc.id,
            originalName: doc.originalName,
            mimeType: doc.mimeType,
          } satisfies SavedAttachment;
        }),
      );
      return resolved.filter((a): a is SavedAttachment => a !== null);
    },
  };
}
