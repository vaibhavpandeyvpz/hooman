import { useState } from "react";
import { PencilIcon, PlusIcon, TrashIcon } from "lucide-react";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card.js";
import { McpServerDialog } from "./McpServerDialog.js";
import { runManagementAction } from "./run-action.js";
import { StickyToolbar } from "./StickyToolbar.js";
import type { McpServerSummary } from "./use-management-data.js";

function transportSummary(server: McpServerSummary): string {
  if (server.transport.command) {
    return `${server.transport.command} ${(server.transport.args ?? []).join(" ")}`.trim();
  }
  return server.transport.url ?? "";
}

export function McpTab(props: {
  servers: McpServerSummary[];
  reload: () => Promise<void>;
}) {
  const { servers, reload } = props;
  const [editing, setEditing] = useState<McpServerSummary | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const deleteServer = (name: string) => {
    if (!window.confirm(`Delete MCP server "${name}"?`)) return;
    void runManagementAction(
      () => window.hooman.deleteMcpServer(name),
      "MCP server deleted.",
      reload,
    );
  };

  return (
    <div>
      <StickyToolbar>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <PlusIcon /> Add server
        </Button>
      </StickyToolbar>
      <div className="space-y-3 p-4">
        {servers.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No MCP servers configured.
          </p>
        ) : (
          <div className="space-y-2">
            {servers.map((server) => (
              <Card key={server.name}>
                <CardHeader>
                  <div>
                    <CardTitle>
                      {server.name}
                      <Badge variant="outline">{server.scope}</Badge>
                    </CardTitle>
                    <CardDescription>
                      {transportSummary(server)}
                    </CardDescription>
                  </div>
                  <CardAction>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setEditing(server);
                        setDialogOpen(true);
                      }}
                    >
                      <PencilIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteServer(server.name)}
                    >
                      <TrashIcon />
                    </Button>
                  </CardAction>
                </CardHeader>
              </Card>
            ))}
          </div>
        )}
      </div>
      <McpServerDialog
        server={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        reload={reload}
      />
    </div>
  );
}
