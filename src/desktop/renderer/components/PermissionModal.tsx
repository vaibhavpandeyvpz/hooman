import type { HoomanPermissionRequestPayload } from "../global";
import { Button } from "./Button.js";

export function PermissionModal({
  request,
  onRespond,
}: {
  request: HoomanPermissionRequestPayload;
  onRespond: (optionId: string) => void;
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/60">
      <div className="w-80 rounded-md border border-slate-800 bg-slate-900 p-4">
        <div className="mb-3 text-[13px] font-medium">
          Hooman wants permission to run a tool
        </div>
        <div className="flex flex-col gap-2">
          {request.options.map((option) => (
            <Button
              key={option.optionId}
              variant={
                option.optionId.includes("reject") ? "secondary" : "primary"
              }
              onClick={() => onRespond(option.optionId)}
            >
              {option.name}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
