import Transcript from "./components/Transcript";
import PlanPanel from "./components/PlanPanel";
import EditsPanel from "./components/EditsPanel";
import QueuePanel from "./components/QueuePanel";
import SessionsPanel from "./components/SessionsPanel";
import LoadingOverlay from "./components/LoadingOverlay";
import StatusStrip from "./components/StatusStrip";
import UsageFooter from "./components/UsageFooter";
import Composer from "./components/Composer";

export default function App() {
  return (
    <div class="relative flex h-full min-h-0 flex-col">
      <Transcript />
      <PlanPanel />
      <EditsPanel />
      <QueuePanel />
      <StatusStrip />
      <UsageFooter />
      <Composer />
      <SessionsPanel />
      <LoadingOverlay />
    </div>
  );
}
