import { useState } from "react";
import { PencilIcon, PlusIcon, TrashIcon } from "lucide-react";
import type { ManagementProvider } from "../../global";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardAction, CardHeader, CardTitle } from "../ui/card.js";
import { ProviderDialog } from "./ProviderDialog.js";
import { StickyToolbar } from "./StickyToolbar.js";
import { runManagementAction } from "./run-action.js";
import { PROVIDER_LABELS, type ProviderType } from "./provider-types.js";

export function ProvidersTab(props: {
  providers: ManagementProvider[];
  reload: () => Promise<void>;
}) {
  const { providers, reload } = props;
  const [editing, setEditing] = useState<ManagementProvider | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const deleteProvider = (name: string) => {
    if (!window.confirm(`Delete provider "${name}"?`)) return;
    void runManagementAction(
      () => window.hooman.deleteProvider(name),
      "Provider deleted.",
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
          <PlusIcon /> Add provider
        </Button>
      </StickyToolbar>
      <div className="space-y-3 p-4">
        {providers.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No providers configured.
          </p>
        ) : (
          <div className="space-y-2">
            {providers.map((provider) => (
              <Card key={provider.name}>
                <CardHeader>
                  <CardTitle>
                    {provider.name}
                    <Badge variant="outline">
                      {PROVIDER_LABELS[provider.provider as ProviderType] ??
                        provider.provider}
                    </Badge>
                  </CardTitle>
                  <CardAction>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setEditing(provider);
                        setDialogOpen(true);
                      }}
                    >
                      <PencilIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteProvider(provider.name)}
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
      <ProviderDialog
        provider={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        reload={reload}
      />
    </div>
  );
}
