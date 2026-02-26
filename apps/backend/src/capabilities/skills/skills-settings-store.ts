import { getPrisma } from "../../data/db.js";

export interface SkillSettingsStore {
  /** Map of skillId -> enabled. Missing key means enabled (default true). */
  getAll(): Promise<Record<string, boolean>>;
  setEnabled(skillId: string, enabled: boolean): Promise<void>;
}

export async function initSkillSettingsStore(): Promise<SkillSettingsStore> {
  const prisma = getPrisma();

  return {
    async getAll(): Promise<Record<string, boolean>> {
      const rows = await prisma.skillSetting.findMany();
      const out: Record<string, boolean> = {};
      for (const r of rows) {
        out[r.skillId] = r.enabled;
      }
      return out;
    },

    async setEnabled(skillId: string, enabled: boolean): Promise<void> {
      if (enabled) {
        await prisma.skillSetting.deleteMany({ where: { skillId } });
      } else {
        await prisma.skillSetting.upsert({
          where: { skillId },
          create: { skillId, enabled: false },
          update: { enabled: false },
        });
      }
    },
  };
}
