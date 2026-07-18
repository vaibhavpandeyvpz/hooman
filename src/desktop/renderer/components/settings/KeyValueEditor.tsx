import { PlusIcon, XIcon } from "lucide-react";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";

export type KeyValueEntry = { key: string; value: string };

/**
 * Generic key/value rows editor — used for provider "extra options" (beyond
 * the common apiKey/baseURL fields) and MCP server env/headers. A friendlier
 * alternative to editing a raw-JSON textarea for the same data.
 */
export function KeyValueEditor(props: {
  keyPlaceholder: string;
  valuePlaceholder: string;
  entries: KeyValueEntry[];
  onChange: (entries: KeyValueEntry[]) => void;
}) {
  return (
    <div className="space-y-1.5">
      {props.entries.map((entry, index) => (
        <div key={index} className="flex gap-1.5">
          <Input
            placeholder={props.keyPlaceholder}
            value={entry.key}
            onChange={(event) =>
              props.onChange(
                props.entries.map((item, itemIndex) =>
                  itemIndex === index
                    ? { ...item, key: event.target.value }
                    : item,
                ),
              )
            }
          />
          <Input
            placeholder={props.valuePlaceholder}
            value={entry.value}
            onChange={(event) =>
              props.onChange(
                props.entries.map((item, itemIndex) =>
                  itemIndex === index
                    ? { ...item, value: event.target.value }
                    : item,
                ),
              )
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() =>
              props.onChange(props.entries.filter((_, i) => i !== index))
            }
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          props.onChange([...props.entries, { key: "", value: "" }])
        }
      >
        <PlusIcon />
        Add
      </Button>
    </div>
  );
}
