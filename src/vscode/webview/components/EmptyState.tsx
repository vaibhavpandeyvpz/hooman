import { For } from "solid-js";
import {
  Bug,
  FileText,
  Paperclip,
  Sparkles,
  SlashSquare,
  TestTubeDiagonal,
} from "lucide-solid";
import type { LucideIcon } from "lucide-solid";
import { Dynamic } from "solid-js/web";
import { prefillComposer } from "../store";
import HoomanLogo from "./HoomanLogo";

type Starter = {
  icon: LucideIcon;
  label: string;
  description: string;
  prompt: string;
};

const STARTERS: Starter[] = [
  {
    icon: Sparkles,
    label: "Explain this codebase",
    description: "Get a guided tour of the project's structure",
    prompt:
      "Give me a tour of this codebase: layout, key modules, and how things fit together.",
  },
  {
    icon: Bug,
    label: "Find and fix a bug",
    description: "Describe a problem and let the agent track it down",
    prompt: "Help me find and fix a bug: ",
  },
  {
    icon: TestTubeDiagonal,
    label: "Write tests",
    description: "Generate tests for a file or feature",
    prompt: "Write tests for ",
  },
  {
    icon: FileText,
    label: "Generate AGENTS.md",
    description: "Document this project for AI agents with /init",
    prompt: "/init",
  },
];

export default function EmptyState() {
  return (
    <div class="m-auto flex w-full max-w-[26rem] flex-col items-center gap-5 px-6 py-8">
      <div class="relative flex flex-col items-center gap-2.5">
        <div class="absolute -top-4 h-24 w-24 rounded-full bg-accent opacity-[0.07] blur-2xl" />
        <HoomanLogo class="h-12 w-12 text-accent" />
        <div class="text-center">
          <h2 class="text-[16px] font-semibold text-foreground">Hooman</h2>
          <p class="text-[12.5px] text-muted">
            Your hackable, local-first AI agent
          </p>
        </div>
      </div>

      <div class="flex w-full flex-col gap-1.5">
        <For each={STARTERS}>
          {(starter) => (
            <button
              type="button"
              class="group flex items-center gap-2.5 rounded-lg border border-border bg-panel px-3 py-2 text-left transition-colors hover:border-focus"
              onClick={() => prefillComposer(starter.prompt)}
            >
              <Dynamic
                component={starter.icon}
                size={15}
                class="shrink-0 text-muted transition-colors group-hover:text-accent"
              />
              <span class="min-w-0">
                <span class="block truncate text-[12.5px] font-medium text-foreground">
                  {starter.label}
                </span>
                <span class="block truncate text-[11.5px] text-muted">
                  {starter.description}
                </span>
              </span>
            </button>
          )}
        </For>
      </div>

      <div class="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-muted">
        <span class="flex items-center gap-1">
          <SlashSquare size={11} />
          slash commands
        </span>
        <span class="flex items-center gap-1">
          <Paperclip size={11} />
          drag, paste, or attach files
        </span>
        <span>
          <kbd class="rounded bg-code-bg px-1 py-px font-mono text-[10px]">
            Shift+Enter
          </kbd>{" "}
          newline
        </span>
      </div>
    </div>
  );
}
