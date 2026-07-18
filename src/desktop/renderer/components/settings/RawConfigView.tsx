import { FileTextIcon } from "lucide-react";
import type { ManagementConfig } from "../../global";
import { Button } from "../ui/button.js";

export function RawConfigView({ config }: { config: ManagementConfig }) {
  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void window.hooman.openConfigFile()}
        >
          <FileTextIcon /> Open config.json
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void window.hooman.openMcpFile()}
        >
          <FileTextIcon /> Open mcp.json
        </Button>
      </div>
      <p className="text-[12px] text-muted-foreground">
        Opens the real file in your OS's default editor (e.g. Notepad on
        Windows) for advanced/manual edits. The view below is read-only and has
        secrets redacted.
      </p>
      <pre className="max-h-96 overflow-y-auto rounded-md border border-border bg-card p-3 text-[12px]">
        {JSON.stringify(config, null, 2)}
      </pre>
    </div>
  );
}
