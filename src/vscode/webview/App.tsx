import { Show } from "solid-js";
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
import { state } from "./store";

export default function App() {
  return (
    <Show
      when={state.route !== "/"}
      fallback={
        <div class="relative flex h-full min-h-0 flex-col">
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
      }
    >
      <PlanEditorView />
    </Show>
  );
}
