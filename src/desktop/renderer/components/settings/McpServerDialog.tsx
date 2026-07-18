import { useState } from "react";
import type { McpServerSummary } from "./use-management-data.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.js";
import { KeyValueEditor, type KeyValueEntry } from "./KeyValueEditor.js";
import { runManagementAction } from "./run-action.js";

type TransportType = "stdio" | "streamable-http" | "sse";

function recordToEntries(
  record: Record<string, string> | undefined,
): KeyValueEntry[] {
  return Object.entries(record ?? {}).map(([key, value]) => ({ key, value }));
}

function entriesToRecord(entries: KeyValueEntry[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const entry of entries) {
    if (entry.key.trim()) record[entry.key.trim()] = entry.value;
  }
  return record;
}

export function McpServerDialog(props: {
  server: McpServerSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reload: () => Promise<void>;
}) {
  const { server, open, onOpenChange, reload } = props;
  const isEdit = server !== null;
  const [name, setName] = useState(server?.name ?? "");
  const [type, setType] = useState<TransportType>(
    (server?.transport.type as TransportType) ?? "stdio",
  );
  const [command, setCommand] = useState(server?.transport.command ?? "");
  const [args, setArgs] = useState((server?.transport.args ?? []).join(" "));
  const [env, setEnv] = useState<KeyValueEntry[]>(
    recordToEntries(server?.transport.env),
  );
  const [url, setUrl] = useState(server?.transport.url ?? "");
  const [headers, setHeaders] = useState<KeyValueEntry[]>(
    recordToEntries(server?.transport.headers),
  );
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName(server?.name ?? "");
    setType((server?.transport.type as TransportType) ?? "stdio");
    setCommand(server?.transport.command ?? "");
    setArgs((server?.transport.args ?? []).join(" "));
    setEnv(recordToEntries(server?.transport.env));
    setUrl(server?.transport.url ?? "");
    setHeaders(recordToEntries(server?.transport.headers));
  };

  const save = async () => {
    if (!name.trim()) return;
    if (type === "stdio" && !command.trim()) return;
    if (type !== "stdio" && !url.trim()) return;
    setSaving(true);
    const transport =
      type === "stdio"
        ? {
            type,
            command: command.trim(),
            args: args.trim() ? args.trim().split(/\s+/) : undefined,
            env: env.length > 0 ? entriesToRecord(env) : undefined,
          }
        : {
            type,
            url: url.trim(),
            headers: headers.length > 0 ? entriesToRecord(headers) : undefined,
          };
    const ok = await runManagementAction(
      () => window.hooman.upsertMcpServer(name.trim(), transport),
      isEdit ? "MCP server saved." : "MCP server added.",
      reload,
    );
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit MCP server" : "Add MCP server"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="mcp-name">Name</Label>
            <Input
              id="mcp-name"
              value={name}
              disabled={isEdit}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-server"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Transport</Label>
            <Select
              value={type}
              onValueChange={(v) => setType(v as TransportType)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stdio">stdio (local command)</SelectItem>
                <SelectItem value="streamable-http">Streamable HTTP</SelectItem>
                <SelectItem value="sse">SSE</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {type === "stdio" ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="mcp-command">Command</Label>
                <Input
                  id="mcp-command"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mcp-args">Arguments</Label>
                <Input
                  id="mcp-args"
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder="-y @modelcontextprotocol/server-example"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Environment variables</Label>
                <KeyValueEditor
                  keyPlaceholder="KEY"
                  valuePlaceholder="value"
                  entries={env}
                  onChange={setEnv}
                />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="mcp-url">URL</Label>
                <Input
                  id="mcp-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/mcp"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Headers</Label>
                <KeyValueEditor
                  keyPlaceholder="Authorization"
                  valuePlaceholder="Bearer …"
                  entries={headers}
                  onChange={setHeaders}
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving || !name.trim()} onClick={() => void save()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
