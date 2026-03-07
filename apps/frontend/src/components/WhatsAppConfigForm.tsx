import React, { useState } from "react";
import { Input } from "./Input";
import { FilterModeField } from "./FilterModeField";
import type { FilterListSelectOption, FilterListTab } from "./FilterListSelect";

export interface WhatsAppConfigFormProps {
  id: string;
  config: Record<string, unknown>;
  onSave: (c: Record<string, unknown>) => void;
  saving: boolean;
  fetchFilterOptions?: () => Promise<FilterListSelectOption[]>;
  fetchFilterTabs?: () => Promise<FilterListTab[]>;
}

export const WhatsAppConfigForm: React.FC<WhatsAppConfigFormProps> = ({
  id,
  config,
  onSave,
  fetchFilterOptions,
  fetchFilterTabs,
}) => {
  const [sessionPath, setSessionPath] = useState(
    String(config.sessionPath ?? ""),
  );
  const [filterMode, setFilterMode] = useState(
    String(config.filterMode ?? "all"),
  );
  const [filterList, setFilterList] = useState(
    Array.isArray(config.filterList) ? config.filterList.join(", ") : "",
  );

  return (
    <form
      id={id}
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          ...config,
          enabled: config.enabled ?? false,
          sessionPath: sessionPath.trim(),
          filterMode: filterMode || "all",
          filterList: filterList
            ? filterList
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
        });
      }}
    >
      <Input
        label="Session folder (optional)"
        placeholder="default"
        value={sessionPath}
        onChange={(e) => setSessionPath(e.target.value)}
      />
      <FilterModeField
        filterMode={filterMode}
        setFilterMode={setFilterMode}
        filterList={filterList}
        setFilterList={setFilterList}
        filterListLabel="Filter list (chat IDs, comma-separated)"
        filterListPlaceholder="Search and select chats, groups…"
        fetchFilterOptions={fetchFilterOptions}
        fetchFilterTabs={fetchFilterTabs}
      />
    </form>
  );
};
