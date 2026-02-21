import { useState, useRef } from "react";
import { Plus } from "lucide-react";
import { McpConnections } from "./McpConnections";
import type { McpConnectionsHandle } from "./McpConnections";
import { Skills } from "./Skills";
import type { SkillsHandle } from "./Skills";
import { Button } from "./Button";

type CapabilityTab = "mcp" | "skills";

export function Capabilities() {
  const [activeTab, setActiveTab] = useState<CapabilityTab>("mcp");
  const mcpRef = useRef<McpConnectionsHandle>(null);
  const skillsRef = useRef<SkillsHandle>(null);

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="border-b border-hooman-border px-4 md:px-6 py-3 md:py-4 flex justify-between items-center gap-3 shrink-0">
        <div className="min-w-0">
          <h2 className="text-base md:text-lg font-semibold text-white">
            Capabilities
          </h2>
          <p className="text-xs md:text-sm text-hooman-muted truncate">
            Connect tools and services so Hooman can act on your behalf.
          </p>
        </div>
        {activeTab === "mcp" && (
          <Button
            onClick={() => mcpRef.current?.startAdd()}
            icon={<Plus className="w-4 h-4" />}
            className="shrink-0"
          >
            Add MCP server
          </Button>
        )}
        {activeTab === "skills" && (
          <Button
            onClick={() => skillsRef.current?.startAdd()}
            icon={<Plus className="w-4 h-4" />}
            className="shrink-0"
          >
            Add skill
          </Button>
        )}
      </header>
      <div className="px-4 md:px-6 pt-3 shrink-0">
        <div className="flex gap-1 border-b border-hooman-border -mb-px">
          <button
            type="button"
            onClick={() => setActiveTab("mcp")}
            className={`px-3 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
              activeTab === "mcp"
                ? "border-hooman-accent text-white bg-hooman-surface"
                : "border-transparent text-hooman-muted hover:text-white"
            }`}
          >
            MCP servers
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("skills")}
            className={`px-3 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
              activeTab === "skills"
                ? "border-hooman-accent text-white bg-hooman-surface"
                : "border-transparent text-hooman-muted hover:text-white"
            }`}
          >
            Skills
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 md:p-6 min-h-0">
        {activeTab === "mcp" && <McpConnections ref={mcpRef} />}
        {activeTab === "skills" && <Skills ref={skillsRef} />}
      </div>
    </div>
  );
}
