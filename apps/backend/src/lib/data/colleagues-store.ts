import { getPrisma } from "./db.js";
import type { ColleagueConfig } from "../core/types.js";

export interface ColleagueStore {
  getAll(): Promise<ColleagueConfig[]>;
  getById(id: string): Promise<ColleagueConfig | null>;
  addOrUpdate(colleague: ColleagueConfig): Promise<void>;
  remove(id: string): Promise<boolean>;
}

function rowToColleague(row: {
  id: string;
  description: string;
  responsibilities: string;
  allowed_connections: string;
  allowed_skills: string;
  memory: string;
  reporting: string;
}): ColleagueConfig {
  const parseArr = (s: string): string[] => {
    try {
      const a = JSON.parse(s) as unknown;
      return Array.isArray(a) ? a.map(String) : [];
    } catch {
      return [];
    }
  };
  const parseMemory = (s: string): { scope: "role" | "global" } => {
    try {
      const o = JSON.parse(s) as { scope?: string };
      return o?.scope === "global" ? { scope: "global" } : { scope: "role" };
    } catch {
      return { scope: "role" };
    }
  };
  const parseReporting = (
    s: string,
  ): { on: ("task_complete" | "uncertainty" | "error")[] } => {
    try {
      const o = JSON.parse(s) as { on?: unknown[] };
      const on = Array.isArray(o?.on) ? o.on : ["task_complete", "uncertainty"];
      return {
        on: on.filter((x): x is "task_complete" | "uncertainty" | "error" =>
          ["task_complete", "uncertainty", "error"].includes(String(x)),
        ) as ("task_complete" | "uncertainty" | "error")[],
      };
    } catch {
      return { on: ["task_complete", "uncertainty"] };
    }
  };

  return {
    id: row.id,
    description: row.description ?? "",
    responsibilities: row.responsibilities ?? "",
    allowed_connections: parseArr(row.allowed_connections),
    allowed_skills: parseArr(row.allowed_skills),
    memory: parseMemory(row.memory),
    reporting: parseReporting(row.reporting),
  };
}

export async function initColleagueStore(): Promise<ColleagueStore> {
  const prisma = getPrisma();

  return {
    async getAll(): Promise<ColleagueConfig[]> {
      const rows = await prisma.colleague.findMany({ orderBy: { id: "asc" } });
      return rows.map(rowToColleague);
    },

    async getById(id: string): Promise<ColleagueConfig | null> {
      const row = await prisma.colleague.findUnique({ where: { id } });
      if (!row) return null;
      return rowToColleague(row);
    },

    async addOrUpdate(colleague: ColleagueConfig): Promise<void> {
      await prisma.colleague.upsert({
        where: { id: colleague.id },
        create: {
          id: colleague.id,
          description: colleague.description ?? "",
          responsibilities: colleague.responsibilities ?? "",
          allowed_connections: JSON.stringify(
            colleague.allowed_connections ?? [],
          ),
          allowed_skills: JSON.stringify(colleague.allowed_skills ?? []),
          memory: JSON.stringify(colleague.memory ?? { scope: "role" }),
          reporting: JSON.stringify(
            colleague.reporting ?? { on: ["task_complete", "uncertainty"] },
          ),
        },
        update: {
          description: colleague.description ?? "",
          responsibilities: colleague.responsibilities ?? "",
          allowed_connections: JSON.stringify(
            colleague.allowed_connections ?? [],
          ),
          allowed_skills: JSON.stringify(colleague.allowed_skills ?? []),
          memory: JSON.stringify(colleague.memory ?? { scope: "role" }),
          reporting: JSON.stringify(
            colleague.reporting ?? { on: ["task_complete", "uncertainty"] },
          ),
        },
      });
    },

    async remove(id: string): Promise<boolean> {
      const result = await prisma.colleague.deleteMany({ where: { id } });
      return (result.count ?? 0) > 0;
    },
  };
}
