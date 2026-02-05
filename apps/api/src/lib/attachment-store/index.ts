import { MongoClient, Collection, ObjectId } from "mongodb";
import { writeFile, readFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

const COL = "chat_attachments";

export interface AttachmentDoc {
  _id?: ObjectId;
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
  /** Save file to disk and Mongo; return id and metadata. */
  save(
    userId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
  ): Promise<SavedAttachment>;
  /** Get metadata by id; optional userId to restrict access. */
  getById(id: string, userId?: string): Promise<AttachmentDoc | null>;
  /** Read file content as buffer; returns null if not found or access denied. */
  getBuffer(id: string, userId?: string): Promise<Buffer | null>;
}

let client: MongoClient | null = null;
let coll: Collection<AttachmentDoc> | null = null;
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
  mongoUri: string,
  attachmentsDataDir: string,
): Promise<AttachmentStore> {
  dataDir = attachmentsDataDir;
  await mkdir(dataDir, { recursive: true });
  client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db("hooman");
  coll = db.collection<AttachmentDoc>(COL);
  await coll.createIndex({ userId: 1, createdAt: -1 });

  async function getById(
    id: string,
    userId?: string,
  ): Promise<AttachmentDoc | null> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      return null;
    }
    const filter: Record<string, unknown> = { _id: oid };
    if (userId !== undefined) filter.userId = userId;
    const doc = await coll!.findOne(filter);
    return doc;
  }

  return {
    async save(userId, file) {
      const ext =
        extFromName(file.originalname) || extFromMime(file.mimetype) || "";
      const storedName = `${randomUUID()}${ext}`;
      const path = join(dataDir, storedName);
      await writeFile(path, file.buffer);
      const doc: AttachmentDoc = {
        userId,
        originalName: file.originalname,
        storedName,
        mimeType: file.mimetype,
        createdAt: new Date(),
      };
      const result = await coll!.insertOne(doc);
      const id = (result.insertedId as ObjectId).toString();
      return { id, originalName: doc.originalName, mimeType: doc.mimeType };
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
