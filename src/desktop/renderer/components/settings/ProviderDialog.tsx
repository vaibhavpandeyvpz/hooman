import { useState } from "react";
import type { ManagementProvider } from "../../global";
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
import {
  PROVIDER_LABELS,
  PROVIDER_TYPES,
  parseExtraValue,
  stringifyExtraValue,
  type ProviderType,
} from "./provider-types.js";

function extraEntriesFromOptions(
  options: Record<string, unknown> | undefined,
): KeyValueEntry[] {
  return Object.entries(options ?? {})
    .filter(([key]) => key !== "apiKey" && key !== "baseURL")
    .map(([key, value]) => ({ key, value: stringifyExtraValue(value) }));
}

export function ProviderDialog(props: {
  provider: ManagementProvider | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reload: () => Promise<void>;
}) {
  const { provider, open, onOpenChange, reload } = props;
  const isEdit = provider !== null;
  const [name, setName] = useState(provider?.name ?? "");
  const [providerType, setProviderType] = useState<ProviderType>(
    (provider?.provider as ProviderType) ?? "openai",
  );
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState(
    typeof provider?.options?.baseURL === "string"
      ? provider.options.baseURL
      : "",
  );
  const [extra, setExtra] = useState<KeyValueEntry[]>(() =>
    extraEntriesFromOptions(provider?.options),
  );
  const [saving, setSaving] = useState(false);

  const originalExtraKeys = new Set(
    Object.keys(provider?.options ?? {}).filter(
      (key) => key !== "apiKey" && key !== "baseURL",
    ),
  );

  const reset = () => {
    setName(provider?.name ?? "");
    setProviderType((provider?.provider as ProviderType) ?? "openai");
    setApiKey("");
    setBaseURL(
      typeof provider?.options?.baseURL === "string"
        ? provider.options.baseURL
        : "",
    );
    setExtra(extraEntriesFromOptions(provider?.options));
  };

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const options: Record<string, unknown> = {};
    if (apiKey.trim()) options.apiKey = apiKey.trim();
    if (isEdit) {
      options.baseURL = baseURL.trim() ? baseURL.trim() : null;
    } else if (baseURL.trim()) {
      options.baseURL = baseURL.trim();
    }
    for (const entry of extra) {
      if (entry.key.trim())
        options[entry.key.trim()] = parseExtraValue(entry.value);
    }
    if (isEdit) {
      const currentKeys = new Set(
        extra.map((entry) => entry.key.trim()).filter(Boolean),
      );
      for (const key of originalExtraKeys) {
        if (!currentKeys.has(key)) options[key] = null;
      }
    }
    const ok = await runManagementAction(
      () => window.hooman.upsertProvider(name.trim(), providerType, options),
      isEdit ? "Provider saved." : "Provider added.",
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
          <DialogTitle>{isEdit ? "Edit provider" : "Add provider"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="provider-name">Name</Label>
            <Input
              id="provider-name"
              value={name}
              disabled={isEdit}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-openai"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Provider type</Label>
            <Select
              value={providerType}
              onValueChange={(value) => setProviderType(value as ProviderType)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {PROVIDER_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="provider-api-key">API key</Label>
              <Input
                id="provider-api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={isEdit ? "•••••••• (unchanged)" : ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="provider-base-url">Base URL</Label>
              <Input
                id="provider-base-url"
                value={baseURL}
                onChange={(e) => setBaseURL(e.target.value)}
                placeholder="http://localhost:11434"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Other options</Label>
            <KeyValueEditor
              keyPlaceholder="region, resourceName, reasoning…"
              valuePlaceholder="value"
              entries={extra}
              onChange={setExtra}
            />
          </div>
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
