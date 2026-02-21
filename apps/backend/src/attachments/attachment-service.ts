import type { AttachmentStore, AttachmentDoc } from "./attachment-store.js";

export interface AttachmentService {
  saveAll(
    userId: string,
    files: Array<{ buffer: Buffer; originalname: string; mimetype: string }>,
  ): Promise<Array<{ id: string; originalName: string; mimeType: string }>>;
  getAttachmentDoc(id: string, userId: string): Promise<AttachmentDoc | null>;
  getAttachmentBuffer(id: string, userId: string): Promise<Buffer | null>;
  resolveAttachments(
    ids: string[],
    userId: string,
  ): Promise<Array<{ name: string; contentType: string; data: string }>>;
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

    async resolveAttachments(ids, userId) {
      const resolved = await Promise.all(
        ids.map(async (id) => {
          const doc = await store.getById(id, userId);
          const buffer = doc ? await store.getBuffer(id, userId) : null;
          if (!doc || !buffer) return null;
          return {
            name: doc.originalName,
            contentType: doc.mimeType,
            data: buffer.toString("base64"),
          };
        }),
      );
      return resolved.filter(
        (a): a is { name: string; contentType: string; data: string } =>
          a !== null,
      );
    },
  };
}
