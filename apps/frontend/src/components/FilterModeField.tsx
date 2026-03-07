import { Select } from "./Select";
import { Input } from "./Input";
import { FilterListSelect } from "./FilterListSelect";
import type { FilterListSelectOption, FilterListTab } from "./FilterListSelect";

export function FilterModeField({
  filterMode,
  setFilterMode,
  filterList,
  setFilterList,
  filterLabel = "Filter mode",
  filterListLabel = "Filter list (comma-separated)",
  filterListPlaceholder = "",
  options,
  /** When set and filter mode is not "all", show multi-select with autocomplete instead of plain input. */
  fetchFilterOptions,
  /** When set, show tabs (e.g. Users, Groups, Channels). Takes precedence over fetchFilterOptions. */
  fetchFilterTabs,
}: {
  filterMode: string;
  setFilterMode: (v: string) => void;
  filterList: string;
  setFilterList: (v: string) => void;
  filterLabel?: string;
  filterListLabel?: string;
  filterListPlaceholder?: string;
  options?: { value: string; label: string }[];
  fetchFilterOptions?: () => Promise<FilterListSelectOption[]>;
  fetchFilterTabs?: () => Promise<FilterListTab[]>;
}) {
  return (
    <>
      <Select
        label={filterLabel}
        value={filterMode}
        onChange={(value) => setFilterMode(value)}
        options={
          options ?? [
            { value: "all", label: "All" },
            { value: "allowlist", label: "Allowlist" },
            { value: "blocklist", label: "Blocklist" },
          ]
        }
      />
      {filterMode !== "all" &&
        (fetchFilterTabs ? (
          <FilterListSelect
            label={filterListLabel}
            value={filterList}
            onChange={setFilterList}
            fetchTabs={fetchFilterTabs}
            placeholder={filterListPlaceholder}
          />
        ) : fetchFilterOptions ? (
          <FilterListSelect
            label={filterListLabel}
            value={filterList}
            onChange={setFilterList}
            fetchOptions={fetchFilterOptions}
            placeholder={filterListPlaceholder}
          />
        ) : (
          <Input
            label={filterListLabel}
            placeholder={filterListPlaceholder}
            value={filterList}
            onChange={(e) => setFilterList(e.target.value)}
          />
        ))}
    </>
  );
}
