import type { Express, Request, Response } from "express";
import type { AppContext } from "../utils/helpers.js";

export function registerAuditRoutes(app: Express, ctx: AppContext): void {
  app.get("/api/audit", async (_req: Request, res: Response) => {
    const entries = await ctx.auditLog.getAuditLog();
    res.json({ entries });
  });
}
