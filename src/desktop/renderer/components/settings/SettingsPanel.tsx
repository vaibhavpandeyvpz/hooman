import { FileTextIcon } from "lucide-react";
import { Button } from "../ui/button.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js";
import { GeneralTab } from "./GeneralTab.js";
import { LlmsTab } from "./LlmsTab.js";
import { McpTab } from "./McpTab.js";
import { ProvidersTab } from "./ProvidersTab.js";
import { RawConfigView } from "./RawConfigView.js";
import { SkillsTab } from "./SkillsTab.js";
import { useManagementData } from "./use-management-data.js";

/**
 * Sectioned Settings screen backed by the versioned management RPC
 * (`hooman management`, plan §5.4). Provider/LLM/MCP CRUD and the
 * general/prompts/tools/search mutations all write through real, validated
 * config — this is a friendlier front end for exactly that, not a separate
 * source of truth. `config.json`/`mcp.json` stay editable in the OS's
 * native editor via the "Raw" tab for anyone who wants to hand-edit.
 */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { config, mcpServers, skills, loading, error, version, reload } =
    useManagementData();

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-[13px] font-medium text-foreground">
          Settings
        </span>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </header>
      {error && (
        <p className="border-b border-border px-4 py-2 text-[13px] text-hooman-error">
          {error}
        </p>
      )}
      {loading && !config && (
        <p className="p-4 text-[13px] text-muted-foreground">Loading…</p>
      )}
      {!loading && !config && (
        <p className="p-4 text-[13px] text-muted-foreground">
          Not configured — run <code>hooman setup</code>.
        </p>
      )}
      {config && (
        <Tabs defaultValue="general" className="min-h-0 flex-1 gap-0">
          <div className="shrink-0 border-b border-border px-4 py-2.5">
            <TabsList>
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="providers">Providers</TabsTrigger>
              <TabsTrigger value="llms">LLMs</TabsTrigger>
              <TabsTrigger value="mcp">MCP servers</TabsTrigger>
              <TabsTrigger value="skills">Skills</TabsTrigger>
              <TabsTrigger value="raw">
                <FileTextIcon /> Raw
              </TabsTrigger>
            </TabsList>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <TabsContent value="general">
              <GeneralTab config={config} version={version} reload={reload} />
            </TabsContent>
            <TabsContent value="providers">
              <ProvidersTab providers={config.providers} reload={reload} />
            </TabsContent>
            <TabsContent value="llms">
              <LlmsTab
                llms={config.llms}
                providers={config.providers}
                reload={reload}
              />
            </TabsContent>
            <TabsContent value="mcp">
              <McpTab servers={mcpServers} reload={reload} />
            </TabsContent>
            <TabsContent value="skills">
              <SkillsTab skills={skills} reload={reload} />
            </TabsContent>
            <TabsContent value="raw">
              <RawConfigView config={config} />
            </TabsContent>
          </div>
        </Tabs>
      )}
    </div>
  );
}
