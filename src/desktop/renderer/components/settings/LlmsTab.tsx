import { useState } from "react";
import { PencilIcon, PlusIcon, TrashIcon } from "lucide-react";
import type { ManagementLlm, ManagementProvider } from "../../global";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card.js";
import { LlmDialog } from "./LlmDialog.js";
import { runManagementAction } from "./run-action.js";
import { StickyToolbar } from "./StickyToolbar.js";

export function LlmsTab(props: {
  llms: ManagementLlm[];
  providers: ManagementProvider[];
  reload: () => Promise<void>;
}) {
  const { llms, providers, reload } = props;
  const [editing, setEditing] = useState<ManagementLlm | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const deleteLlm = (name: string) => {
    if (!window.confirm(`Delete LLM "${name}"?`)) return;
    void runManagementAction(
      () => window.hooman.deleteLlm(name),
      "LLM deleted.",
      reload,
    );
  };

  return (
    <div>
      <StickyToolbar>
        <Button
          size="sm"
          disabled={providers.length === 0}
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <PlusIcon /> Add LLM
        </Button>
      </StickyToolbar>
      <div className="space-y-3 p-4">
        {providers.length === 0 && (
          <p className="text-[13px] text-muted-foreground">
            Add a provider first before configuring an LLM.
          </p>
        )}
        {llms.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No LLMs configured.
          </p>
        ) : (
          <div className="space-y-2">
            {llms.map((llm) => (
              <Card key={llm.name}>
                <CardHeader>
                  <div>
                    <CardTitle>
                      {llm.name}
                      {llm.default && <Badge variant="success">default</Badge>}
                    </CardTitle>
                    <CardDescription>
                      {llm.provider} · {llm.options.model}
                    </CardDescription>
                  </div>
                  <CardAction>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setEditing(llm);
                        setDialogOpen(true);
                      }}
                    >
                      <PencilIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteLlm(llm.name)}
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
      <LlmDialog
        llm={editing}
        providers={providers}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        reload={reload}
      />
    </div>
  );
}
