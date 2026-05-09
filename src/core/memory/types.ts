export type Memory = {
  id: string;
  type: MemoryType;
  content: string;
  metadata: Record<string, unknown>;
  archived: boolean;
  createdAt: Date;
  distance?: number | null;
  score?: number | null;
};

export type MemoryType = "fact" | "observation" | "preference" | "task";
