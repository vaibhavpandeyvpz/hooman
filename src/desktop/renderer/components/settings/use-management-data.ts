import { useCallback, useEffect, useState } from "react";
import type { ManagementConfig, SkillInstalledEntry } from "../../global";

export type McpServerSummary = {
  name: string;
  transport: {
    type?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
  };
  sourcePath: string;
  scope: "global" | "project";
};

export type SkillSummary = SkillInstalledEntry;

/**
 * Loads the management RPC summary (redacted config + MCP servers + skills)
 * once and exposes a `reload()` for after any mutation. `version` bumps on
 * every successful reload so uncontrolled form fields (plain text inputs)
 * can force a remount (`key={version}`) to pick up the latest server value
 * without fighting the user's typing on every keystroke.
 */
export function useManagementData() {
  const [config, setConfig] = useState<ManagementConfig | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServerSummary[]>([]);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const summary = await window.hooman.getManagementSummary();
      setConfig(summary.config);
      setMcpServers(summary.mcpServers as McpServerSummary[]);
      setSkills(summary.skills);
      setError(null);
      setVersion((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { config, mcpServers, skills, loading, error, version, reload };
}
