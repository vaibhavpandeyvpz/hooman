export const MODE_IDS = ["agent", "ask", "plan"] as const;

export type KnownSessionMode = (typeof MODE_IDS)[number];
export type SessionMode = KnownSessionMode | (string & {});

export const DEFAULT_SESSION_MODE: KnownSessionMode = "agent";

export function isKnownSessionMode(mode: string): mode is KnownSessionMode {
  return MODE_IDS.includes(mode as KnownSessionMode);
}
