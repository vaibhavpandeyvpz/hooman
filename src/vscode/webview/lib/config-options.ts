import type {
  SessionConfigSelectOptions,
  SessionConfigSelectOption,
} from "@agentclientprotocol/sdk";

/** Flattens grouped or ungrouped select options into a single list for a picker menu. */
export function flattenSelectOptions(
  options: SessionConfigSelectOptions,
): SessionConfigSelectOption[] {
  const flat: SessionConfigSelectOption[] = [];
  for (const entry of options) {
    if ("options" in entry && Array.isArray(entry.options)) {
      flat.push(...entry.options);
    } else if ("value" in entry) {
      flat.push(entry);
    }
  }
  return flat;
}
