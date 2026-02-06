import { getPrisma } from "./db.js";
import { writeFile, readFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

export interface AttachmentDoc {
  id: string;
  userId: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  createdAt: Date;
}

export interface SavedAttachment {
  id: string;
  originalName: string;
  mimeType: string;
}

export interface AttachmentStore {
  save(
    userId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
  ): Promise<SavedAttachment>;
  getById(id: string, userId?: string): Promise<AttachmentDoc | null>;
  getBuffer(id: string, userId?: string): Promise<Buffer | null>;
}

let dataDir: string = "";

function extFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "text/plain": ".txt",
    "application/pdf": ".pdf",
  };
  const base = mimeType.split(";")[0].trim().toLowerCase();
  return map[base] ?? "";
}

function extFromName(originalName: string): string {
  const idx = originalName.lastIndexOf(".");
  if (idx === -1) return "";
  return originalName.slice(idx).slice(0, 20);
}

export async function initAttachmentStore(
  attachmentsDataDir: string,
): Promise<AttachmentStore> {
  dataDir = attachmentsDataDir;
  await mkdir(dataDir, { recursive: true });
  const prisma = getPrisma();

  async function getById(
    id: string,
    userId?: string,
  ): Promise<AttachmentDoc | null> {
    const where: { id: string; userId?: string } = { id };
    if (userId !== undefined) where.userId = userId;
    const row = await prisma.chatAttachment.findFirst({ where });
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      originalName: row.originalName,
      storedName: row.storedName,
      mimeType: row.mimeType,
      createdAt: row.createdAt,
    };
  }

  return {
    async save(userId, file) {
      const ext =
        extFromName(file.originalname) || extFromMime(file.mimetype) || "";
      const storedName = `${randomUUID()}${ext}`;
      const path = join(dataDir, storedName);
      await writeFile(path, file.buffer);

      const row = await prisma.chatAttachment.create({
        data: {
          userId,
          originalName: file.originalname,
          storedName,
          mimeType: file.mimetype,
        },
      });

      return {
        id: row.id,
        originalName: row.originalName,
        mimeType: row.mimeType,
      };
    },
    getById,
    async getBuffer(id: string, userId?: string) {
      const doc = await getById(id, userId);
      if (!doc) return null;
      const path = join(dataDir, doc.storedName);
      try {
        return await readFile(path);
      } catch {
        return null;
      }
    },
  };
}
