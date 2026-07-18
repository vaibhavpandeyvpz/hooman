import { useState } from "react";
import type { ManagementLlm, ManagementProvider } from "../../global";
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
import { Switch } from "../ui/switch.js";
import { runManagementAction } from "./run-action.js";

function numberOrUndefined(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function LlmDialog(props: {
  llm: ManagementLlm | null;
  providers: ManagementProvider[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reload: () => Promise<void>;
}) {
  const { llm, providers, open, onOpenChange, reload } = props;
  const isEdit = llm !== null;
  const [name, setName] = useState(llm?.name ?? "");
  const [provider, setProvider] = useState(
    llm?.provider ?? providers[0]?.name ?? "",
  );
  const [model, setModel] = useState(llm?.options.model ?? "");
  const [isDefault, setIsDefault] = useState(llm?.default ?? false);
  const [temperature, setTemperature] = useState(
    llm?.options.temperature?.toString() ?? "",
  );
  const [topP, setTopP] = useState(llm?.options.topP?.toString() ?? "");
  const [maxTokens, setMaxTokens] = useState(
    llm?.options.maxTokens?.toString() ?? "",
  );
  const [context, setContext] = useState(
    llm?.options.context?.toString() ?? "",
  );
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName(llm?.name ?? "");
    setProvider(llm?.provider ?? providers[0]?.name ?? "");
    setModel(llm?.options.model ?? "");
    setIsDefault(llm?.default ?? false);
    setTemperature(llm?.options.temperature?.toString() ?? "");
    setTopP(llm?.options.topP?.toString() ?? "");
    setMaxTokens(llm?.options.maxTokens?.toString() ?? "");
    setContext(llm?.options.context?.toString() ?? "");
  };

  const save = async () => {
    if (!name.trim() || !provider || !model.trim()) return;
    setSaving(true);
    const ok = await runManagementAction(
      () =>
        window.hooman.upsertLlm({
          name: name.trim(),
          provider,
          options: {
            model: model.trim(),
            temperature: numberOrUndefined(temperature),
            topP: numberOrUndefined(topP),
            maxTokens: numberOrUndefined(maxTokens),
            context: numberOrUndefined(context),
          },
          default: isDefault,
        }),
      isEdit ? "LLM saved." : "LLM added.",
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
          <DialogTitle>{isEdit ? "Edit LLM" : "Add LLM"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="llm-name">Name</Label>
            <Input
              id="llm-name"
              value={name}
              disabled={isEdit}
              onChange={(e) => setName(e.target.value)}
              placeholder="gpt-5"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Provider</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a provider" />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.name} value={p.name}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="llm-model">Model</Label>
            <Input
              id="llm-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gpt-5.4"
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="llm-default">Default LLM</Label>
            <Switch
              id="llm-default"
              checked={isDefault}
              onCheckedChange={setIsDefault}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="llm-temperature">Temperature</Label>
              <Input
                id="llm-temperature"
                type="number"
                step={0.1}
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="llm-top-p">Top P</Label>
              <Input
                id="llm-top-p"
                type="number"
                step={0.1}
                value={topP}
                onChange={(e) => setTopP(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="llm-max-tokens">Max tokens</Label>
              <Input
                id="llm-max-tokens"
                type="number"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="llm-context">Context window</Label>
              <Input
                id="llm-context"
                type="number"
                value={context}
                onChange={(e) => setContext(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={saving || !name.trim() || !provider || !model.trim()}
            onClick={() => void save()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
