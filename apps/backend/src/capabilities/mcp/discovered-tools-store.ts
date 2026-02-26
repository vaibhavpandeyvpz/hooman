import { getPrisma } from "../../data/db.js";
import type { DiscoveredTool } from "./manager.js";

export interface DiscoveredToolsStore {
  replaceAll(tools: DiscoveredTool[]): Promise<void>;
  getAll(): Promise<DiscoveredTool[]>;
}

export interface CreateDiscoveredToolsStoreOptions {
  /** Called after replaceAll writes to DB (e.g. worker publishes to Redis). */
  onReplaceAll?: () => void;
}

export function createDiscoveredToolsStore(
  options?: CreateDiscoveredToolsStoreOptions,
): DiscoveredToolsStore {
  const prisma = getPrisma();
  const onReplaceAll = options?.onReplaceAll;

  return {
    async replaceAll(tools: DiscoveredTool[]): Promise<void> {
      await prisma.discoveredTool.deleteMany({});
      if (tools.length > 0) {
        await prisma.discoveredTool.createMany({
          data: tools.map((t) => ({
            id: t.id,
            name: t.name,
            description: t.description ?? null,
            connectionId: t.connectionId,
            connectionName: t.connectionName,
          })),
        });
      }
      onReplaceAll?.();
    },

    async getAll(): Promise<DiscoveredTool[]> {
      const rows = await prisma.discoveredTool.findMany({
        orderBy: [{ connectionName: "asc" }, { name: "asc" }],
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description ?? undefined,
        connectionId: r.connectionId,
        connectionName: r.connectionName,
      }));
    },
  };
}
