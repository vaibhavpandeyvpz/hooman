import { getPrisma } from "./db.js";

export interface ScheduledTaskDoc {
  id: string;
  execute_at: string;
  intent: string;
  context: Record<string, unknown>;
}

export interface ScheduleStore {
  getAll(): Promise<ScheduledTaskDoc[]>;
  add(task: ScheduledTaskDoc): Promise<void>;
  remove(id: string): Promise<boolean>;
}

function parseContext(s: string | null): Record<string, unknown> {
  if (s == null || s === "") return {};
  try {
    const o = JSON.parse(s) as unknown;
    return o && typeof o === "object" && !Array.isArray(o)
      ? (o as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function initScheduleStore(): Promise<ScheduleStore> {
  const prisma = getPrisma();

  return {
    async getAll(): Promise<ScheduledTaskDoc[]> {
      const rows = await prisma.schedule.findMany({
        orderBy: { execute_at: "asc" },
      });
      return rows.map((r) => ({
        id: r.id,
        execute_at: r.execute_at,
        intent: r.intent,
        context: parseContext(r.context),
      }));
    },

    async add(task: ScheduledTaskDoc): Promise<void> {
      await prisma.schedule.create({
        data: {
          id: task.id,
          execute_at: task.execute_at,
          intent: task.intent,
          context: JSON.stringify(task.context ?? {}),
        },
      });
    },

    async remove(id: string): Promise<boolean> {
      const result = await prisma.schedule.deleteMany({ where: { id } });
      return (result.count ?? 0) > 0;
    },
  };
}
