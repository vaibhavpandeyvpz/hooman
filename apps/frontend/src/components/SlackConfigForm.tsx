import React, { useState } from "react";
import { Input } from "./Input";
import { Radio } from "./Radio";
import { FilterModeField } from "./FilterModeField";
import type { FilterListSelectOption, FilterListTab } from "./FilterListSelect";

export interface SlackConfigFormProps {
  id: string;
  config: Record<string, unknown>;
  onSave: (c: Record<string, unknown>) => void;
  saving: boolean;
  fetchFilterOptions?: () => Promise<FilterListSelectOption[]>;
  fetchFilterTabs?: () => Promise<FilterListTab[]>;
}

export const SlackConfigForm: React.FC<SlackConfigFormProps> = ({
  id,
  config,
  onSave,
  fetchFilterOptions,
  fetchFilterTabs,
}) => {
  const connectAsOptions = [
    { value: "bot", label: "Bot" },
    { value: "user", label: "User" },
  ] as const;
  const [connectAs, setConnectAs] = useState<"bot" | "user">(
    (config.connectAs as "bot" | "user") ?? "user",
  );
  const [appToken, setAppToken] = useState(String(config.appToken ?? ""));
  const [userToken, setUserToken] = useState(String(config.userToken ?? ""));
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
          connectAs,
          appToken: appToken.trim() || undefined,
          userToken: userToken.trim() || undefined,
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
      <div>
        <span className="block text-sm font-medium text-zinc-300 mb-2">
          Connect as
        </span>
        <div className="flex gap-4">
          {connectAsOptions.map((opt) => (
            <Radio
              key={opt.value}
              name="slack-connect-as"
              value={opt.value}
              checked={connectAs === opt.value}
              onChange={() => setConnectAs(opt.value)}
              label={opt.label}
            />
          ))}
        </div>
      </div>
      <Input
        label="App token (xapp-…)"
        type="password"
        placeholder="Leave blank to keep current"
        value={appToken}
        onChange={(e) => setAppToken(e.target.value)}
      />
      <Input
        label={
          connectAs === "bot" ? "Bot token (xoxb-…)" : "User token (xoxp-…)"
        }
        type="password"
        placeholder="Leave blank to keep current"
        value={userToken}
        onChange={(e) => setUserToken(e.target.value)}
      />
      <FilterModeField
        filterMode={filterMode}
        setFilterMode={setFilterMode}
        filterList={filterList}
        setFilterList={setFilterList}
        filterListLabel="Filter list (comma-separated IDs)"
        filterListPlaceholder="Search and select channels, DMs…"
        fetchFilterOptions={fetchFilterOptions}
        fetchFilterTabs={fetchFilterTabs}
      />
    </form>
  );
};
