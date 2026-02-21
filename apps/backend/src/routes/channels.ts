import type { Express, Request, Response } from "express";
import type { AppContext } from "../utils/helpers.js";
import { getChannelsConfig } from "../config.js";

export function registerChannelRoutes(app: Express, ctx: AppContext): void {
  const { channelService } = ctx;

  app.get("/api/channels", (_req: Request, res: Response) => {
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
}
