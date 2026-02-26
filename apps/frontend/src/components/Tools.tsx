import {
  useEffect,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import { RefreshCw, Wrench, Search, ChevronDown } from "lucide-react";
import {
  getDiscoveredTools,
  reloadMcpTools,
  type DiscoveredTool,
} from "../api";
import { getSocket } from "../socket";
import { Button } from "./Button";

interface ToolGroup {
  connectionId: string;
  connectionName: string;
  tools: DiscoveredTool[];
}

export interface ToolsHandle {
  refresh: () => Promise<void>;
}

export const Tools = forwardRef<ToolsHandle, object>(
  function Tools(_props, ref) {
    const [tools, setTools] = useState<DiscoveredTool[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState("");
    const [expandedToolIds, setExpandedToolIds] = useState<Set<string>>(
      () => new Set(),
    );
    const [expandedConnectionIds, setExpandedConnectionIds] = useState<
      Set<string>
    >(() => new Set());

    const toggleConnection = useCallback((connectionId: string) => {
      setExpandedConnectionIds((prev) => {
        const next = new Set(prev);
        if (next.has(connectionId)) next.delete(connectionId);
        else next.add(connectionId);
        return next;
      });
    }, []);

    const fetchTools = useCallback(async () => {
      try {
        const data = await getDiscoveredTools();
        setTools(data.tools);
      } catch {
        setTools([]);
      }
    }, []);

    const reload = useCallback(async () => {
      setLoading(true);
      try {
        await reloadMcpTools();
      } catch {
        setLoading(false);
      }
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        refresh: reload,
      }),
      [reload],
    );

    useEffect(() => {
      fetchTools().finally(() => setLoading(false));
    }, [fetchTools]);

    useEffect(() => {
      const socket = getSocket();
      const onReloaded = () => {
        fetchTools().finally(() => setLoading(false));
      };
      socket.on("mcp-tools-reloaded", onReloaded);
      return () => {
        socket.off("mcp-tools-reloaded", onReloaded);
      };
    }, [fetchTools]);

    const grouped: ToolGroup[] = [];
    const seen = new Map<string, ToolGroup>();
    for (const tool of tools) {
      let group = seen.get(tool.connectionId);
      if (!group) {
        group = {
          connectionId: tool.connectionId,
          connectionName: tool.connectionName,
          tools: [],
        };
        seen.set(tool.connectionId, group);
        grouped.push(group);
      }
      group.tools.push(tool);
    }

    const lowerFilter = filter.toLowerCase();
    const filteredGroups = grouped
      .map((g) => ({
        ...g,
        tools: g.tools.filter(
          (t) =>
            t.name.toLowerCase().includes(lowerFilter) ||
            t.description?.toLowerCase().includes(lowerFilter) ||
            g.connectionName.toLowerCase().includes(lowerFilter),
        ),
      }))
      .filter((g) => g.tools.length > 0);

    const totalTools = tools.length;
    const totalFiltered = filteredGroups.reduce(
      (sum, g) => sum + g.tools.length,
      0,
    );

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search tools..."
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-hooman-surface border border-hooman-border text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-hooman-accent"
            />
          </div>
          <Button
            variant="secondary"
            onClick={reload}
            disabled={loading}
            icon={
              <RefreshCw
                className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
              />
            }
          >
            Refresh
          </Button>
        </div>

        {loading && tools.length === 0 ? (
          <div className="text-center text-hooman-muted py-12 text-sm">
            Loading tools...
          </div>
        ) : totalTools === 0 ? (
          <div className="text-center py-12 space-y-2">
            <Wrench className="w-8 h-8 text-zinc-600 mx-auto" />
            <p className="text-hooman-muted text-sm">
              No tools discovered yet. Click Refresh to load tools from MCP
              servers.
            </p>
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="text-center text-hooman-muted py-12 text-sm">
            No tools match &ldquo;{filter}&rdquo;
          </div>
        ) : (
          <>
            <p className="text-xs text-hooman-muted">
              {totalFiltered} tool{totalFiltered !== 1 ? "s" : ""} across{" "}
              {filteredGroups.length} connection
              {filteredGroups.length !== 1 ? "s" : ""}
            </p>
            <div className="space-y-2">
              {filteredGroups.map((group) => {
                const isExpanded = expandedConnectionIds.has(
                  group.connectionId,
                );
                return (
                  <div
                    key={group.connectionId}
                    className="border border-hooman-border rounded-xl overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => toggleConnection(group.connectionId)}
                      className={`w-full px-4 py-2.5 bg-hooman-surface flex items-center gap-2 text-left hover:bg-hooman-border/20 transition-colors ${
                        isExpanded ? "border-b border-hooman-border" : ""
                      }`}
                    >
                      <ChevronDown
                        className={`w-4 h-4 text-hooman-muted shrink-0 transition-transform ${
                          isExpanded ? "" : "-rotate-90"
                        }`}
                      />
                      <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                      <span className="text-sm font-medium text-white">
                        {group.connectionName}
                      </span>
                      <span className="text-xs text-hooman-muted ml-auto">
                        {group.tools.length} tool
                        {group.tools.length !== 1 ? "s" : ""}
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="divide-y divide-hooman-border/50">
                        {group.tools.map((tool) => (
                          <div
                            key={tool.id}
                            className="px-4 py-3 hover:bg-hooman-border/20 transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <Wrench className="w-3.5 h-3.5 text-hooman-accent shrink-0" />
                              <code className="text-sm text-white font-mono">
                                {tool.name}
                              </code>
                            </div>
                            {tool.description && (
                              <div className="mt-1 ml-5.5">
                                <p
                                  className={`text-xs text-hooman-muted leading-relaxed ${
                                    expandedToolIds.has(tool.id)
                                      ? ""
                                      : "line-clamp-2"
                                  }`}
                                >
                                  {tool.description}
                                </p>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedToolIds((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(tool.id))
                                        next.delete(tool.id);
                                      else next.add(tool.id);
                                      return next;
                                    })
                                  }
                                  className="text-xs text-hooman-accent hover:underline mt-0.5"
                                >
                                  {expandedToolIds.has(tool.id)
                                    ? "See less"
                                    : "See more"}
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  },
);
