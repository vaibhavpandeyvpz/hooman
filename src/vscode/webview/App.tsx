import { Match, Switch } from "solid-js";
import { Sparkles } from "lucide-solid";
import TabStrip from "./components/TabStrip";
import Transcript from "./components/Transcript";
import PlanPanel from "./components/PlanPanel";
import EditsPanel from "./components/EditsPanel";
import QueuePanel from "./components/QueuePanel";
import SessionsPanel from "./components/SessionsPanel";
import LoadingOverlay from "./components/LoadingOverlay";
import DownloadStrip from "./components/DownloadStrip";
import StatusStrip from "./components/StatusStrip";
import UsageFooter from "./components/UsageFooter";
import Composer from "./components/Composer";
import PlanEditorView from "./components/PlanEditorView";
import SettingsEditorView from "./components/SettingsEditorView";
import { state } from "./store";

export default function App() {
  return (
    <Switch>
      <Match when={state.route === "/chat"}>
        <div class="relative flex h-full min-h-0 flex-col">
          <TabStrip />
          <Transcript />
          <PlanPanel />
          <EditsPanel />
          <QueuePanel />
          <DownloadStrip />
          <StatusStrip />
          <UsageFooter />
          <Composer />
          <SessionsPanel />
          <LoadingOverlay />
        </div>
      </Match>
      <Match when={state.route.startsWith("/plans/")}>
        <PlanEditorView />
      </Match>
      <Match when={state.route.startsWith("/config/")}>
        <SettingsEditorView mode="config" />
      </Match>
      <Match when={state.route.startsWith("/mcp/")}>
        <SettingsEditorView mode="mcp" />
      </Match>
      <Match when={state.route === "/skills"}>
        <SettingsEditorView mode="skills" />
      </Match>
      <Match when={true}>
        <div class="flex h-full items-center justify-center bg-[var(--vscode-editor-background)] p-6">
          <div class="flex max-w-sm flex-col items-center rounded-lg border border-border bg-panel px-6 py-5 text-center shadow-sm">
            <div class="mb-3 flex h-10 w-10 items-center justify-center rounded-md border border-border bg-[var(--vscode-sideBar-background)] text-accent">
              <Sparkles size={18} />
            </div>
            <div class="text-sm font-medium text-foreground">Hooman</div>
            <p class="mt-1 text-xs leading-5 text-muted">
              Open a chat session, a plan file, or a Hooman config file to get
              started.
            </p>
          </div>
        </div>
      </Match>
    </Switch>
  );
}
