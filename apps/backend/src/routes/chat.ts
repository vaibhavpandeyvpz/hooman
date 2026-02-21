import type { Express, Request, Response } from "express";
import createDebug from "debug";
import multer from "multer";
import type { AppContext } from "../utils/helpers.js";
import { getParam } from "../utils/helpers.js";
import { getKillSwitchEnabled } from "../agents/kill-switch.js";
import { getConfig } from "../config.js";

const debug = createDebug("hooman:routes:chat");

export function registerChatRoutes(app: Express, ctx: AppContext): void {
  const { enqueue, auditLog, chatService, attachmentService } = ctx;
  const upload = multer({ storage: multer.memoryStorage() });

  app.get("/api/chat/history", async (req: Request, res: Response) => {
    const userId = (req.query.userId as string) || "default";
    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const pageSize = Math.min(
      200,
      Math.max(1, parseInt(String(req.query.pageSize), 10) || 50),
    );
    const result = await chatService.getHistory(userId, { page, pageSize });
    res.json(result);
  });

  app.delete("/api/chat/history", async (req: Request, res: Response) => {
    const userId = (req.query.userId as string) || "default";
    await chatService.clearHistory(userId);
    res.json({ cleared: true });
  });

  app.post(
    "/api/chat/attachments",
    upload.array("files", 10),
    async (req: Request, res: Response) => {
      const userId = (req.query.userId as string) || "default";
      const files = (req as Request & { files?: Express.Multer.File[] }).files;
      if (!Array.isArray(files) || files.length === 0) {
        res.status(400).json({ error: "No files uploaded." });
        return;
      }
      try {
        const result = await attachmentService.saveAll(userId, files as any);
        res.json({ attachments: result });
      } catch (err) {
        debug("attachment upload error: %o", err);
        res.status(500).json({ error: "Failed to store attachments." });
      }
    },
  );

  app.get("/api/chat/attachments/:id", async (req: Request, res: Response) => {
    const id = getParam(req, "id");
    const userId = "default";
    const doc = await attachmentService.getAttachmentDoc(id, userId);
    if (!doc) {
      res.status(404).json({ error: "Attachment not found." });
      return;
    }
    const buffer = await attachmentService.getAttachmentBuffer(id, userId);
    if (!buffer) {
      res.status(404).json({ error: "Attachment file not found." });
      return;
    }
    res.setHeader("Content-Type", doc.mimeType);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(doc.originalName)}"`,
    );
    res.send(buffer);
  });

  app.post("/api/chat", async (req: Request, res: Response): Promise<void> => {
    if (getKillSwitchEnabled()) {
      res
        .status(503)
        .json({ error: `${getConfig().AGENT_NAME} is paused (kill switch).` });
      return;
    }
    const text = req.body?.text as string;
    if (!text || typeof text !== "string") {
      res.status(400).json({ error: "Missing or invalid 'text'." });
      return;
    }
    const rawIds = req.body?.attachments;
    const attachmentIds = Array.isArray(rawIds)
      ? ((rawIds as unknown[]).filter(
          (id) => typeof id === "string",
        ) as string[])
      : undefined;

    const userId = (req.body?.userId as string) || "default";
    const eventId = await chatService.sendMessage(
      userId,
      text,
      attachmentIds,
      enqueue,
    );

    res.status(202).json({ eventId });
  });

  app.get("/api/chat/stream", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    const unsub = auditLog.onResponseReceived(
      (payload: { type: string; text?: string }) => {
        if (payload.type === "response") {
          res.write(
            `data: ${JSON.stringify({ type: "response", text: payload.text })}\n\n`,
          );
          res.flushHeaders?.();
        }
      },
    );
    req.on("close", () => unsub());
  });
}
