import type { Express, Request, Response } from "express";
import type { AppContext } from "../utils/helpers.js";
import { getChannelsConfig, loadPersisted } from "../config.js";

export function registerChannelRoutes(app: Express, ctx: AppContext): void {
  const { channelService } = ctx;

  app.get("/api/channels", async (_req: Request, res: Response) => {
    await loadPersisted();
    res.json({ channels: channelService.getChannels() });
  });

  app.patch(
    "/api/channels",
    async (req: Request, res: Response): Promise<void> => {
      try {
        await channelService.updateChannels(req.body);
        res.json({ channels: getChannelsConfig() });
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    },
  );

  app.get(
    "/api/channels/whatsapp/connection",
    async (_req: Request, res: Response) => {
      const result = await channelService.getWhatsAppConnection();
      res.json(result);
    },
  );

  app.post(
    "/api/channels/whatsapp/logout",
    async (_req: Request, res: Response) => {
      try {
        await channelService.logoutWhatsApp();
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );

  app.get(
    "/api/channels/slack/conversations",
    async (_req: Request, res: Response) => {
      try {
        const list = await channelService.getSlackConversations();
        res.json({ conversations: list });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );

  app.get(
    "/api/channels/whatsapp/chats",
    async (_req: Request, res: Response) => {
      try {
        const list = await channelService.getWhatsAppChats();
        res.json({ chats: list });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );

  app.get(
    "/api/channels/whatsapp/contacts",
    async (_req: Request, res: Response) => {
      try {
        const list = await channelService.getWhatsAppContacts();
        res.json({ contacts: list });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );
}
