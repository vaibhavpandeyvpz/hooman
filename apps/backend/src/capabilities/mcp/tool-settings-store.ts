/**
 * Per-tool settings: disabled (turned off) and allowEveryTime (user said "allow every time").
 * Store only exceptions; no row = tool is on and needs approval (unless Settings allow everything).
 */
import { getPrisma } from "../../data/db.js";

export interface ToolSettingsStore {
  getDisabledToolIds(): Promise<Set<string>>;
  getAllowEveryTimeToolIds(): Promise<Set<string>>;
  setDisabled(toolId: string, disabled: boolean): Promise<void>;
  setAllowEveryTime(toolId: string, value: boolean): Promise<void>;
  getSettingsForToolIds(
    toolIds: string[],
  ): Promise<Map<string, { disabled: boolean; allowEveryTime: boolean }>>;
}

export function createToolSettingsStore(): ToolSettingsStore {
  const prisma = getPrisma();

  return {
    async getDisabledToolIds(): Promise<Set<string>> {
      const rows = await prisma.toolSetting.findMany({
        where: { disabled: true },
        select: { toolId: true },
      });
      return new Set(rows.map((r) => r.toolId));
    },

    async getAllowEveryTimeToolIds(): Promise<Set<string>> {
      const rows = await prisma.toolSetting.findMany({
        where: { allowEveryTime: true },
        select: { toolId: true },
      });
      return new Set(rows.map((r) => r.toolId));
    },

    async setDisabled(toolId: string, disabled: boolean): Promise<void> {
      const existing = await prisma.toolSetting.findUnique({
        where: { toolId },
      });
      if (disabled) {
        await prisma.toolSetting.upsert({
          where: { toolId },
          create: { toolId, disabled: true, allowEveryTime: false },
          update: { disabled: true },
        });
      } else {
        if (!existing) return;
        if (existing.allowEveryTime) {
          await prisma.toolSetting.update({
            where: { toolId },
            data: { disabled: false },
          });
        } else {
          await prisma.toolSetting
            .delete({ where: { toolId } })
            .catch(() => {});
        }
      }
    },

    async setAllowEveryTime(toolId: string, value: boolean): Promise<void> {
      const existing = await prisma.toolSetting.findUnique({
        where: { toolId },
      });
      if (value) {
        await prisma.toolSetting.upsert({
          where: { toolId },
          create: { toolId, disabled: false, allowEveryTime: true },
          update: { allowEveryTime: true },
        });
      } else {
        if (!existing) return;
        if (existing.disabled) {
          await prisma.toolSetting.update({
            where: { toolId },
            data: { allowEveryTime: false },
          });
        } else {
          await prisma.toolSetting
            .delete({ where: { toolId } })
            .catch(() => {});
        }
      }
    },

    async getSettingsForToolIds(
      toolIds: string[],
    ): Promise<Map<string, { disabled: boolean; allowEveryTime: boolean }>> {
      if (toolIds.length === 0) return new Map();
      const rows = await prisma.toolSetting.findMany({
        where: { toolId: { in: toolIds } },
      });
      const map = new Map<
        string,
        { disabled: boolean; allowEveryTime: boolean }
      >();
      for (const id of toolIds) {
        const row = rows.find((r) => r.toolId === id);
        map.set(id, {
          disabled: row?.disabled ?? false,
          allowEveryTime: row?.allowEveryTime ?? false,
        });
      }
      return map;
    },
  };
}
