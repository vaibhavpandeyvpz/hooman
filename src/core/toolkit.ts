export const TOOLKITS = ["lite", "full", "max"] as const;

export type Toolkit = (typeof TOOLKITS)[number];

const TOOLKIT_RANK: Record<Toolkit, number> = {
  lite: 0,
  full: 1,
  max: 2,
};

export function toolkitAtLeast(actual: Toolkit, minimum: Toolkit): boolean {
  return TOOLKIT_RANK[actual] >= TOOLKIT_RANK[minimum];
}
