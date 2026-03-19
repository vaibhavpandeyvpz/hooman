import { useState, useEffect } from "react";
import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { getToken } from "./auth";
import { getAuthStatus } from "./api";
import { Chat } from "./components/Chat";
import { Channels } from "./components/Channels";
import { Sidebar } from "./components/Sidebar";
import { Schedule } from "./components/Schedule";
import { Audit } from "./components/Audit";
import { Safety } from "./components/Safety";
import { Capabilities } from "./components/Capabilities";
import { Settings } from "./components/Settings";
import { Login } from "./components/Login";

function RedirectToChatOrLogin() {
  const [authRequired, setAuthRequired] = useState<boolean | null>(null);

  useEffect(() => {
    getAuthStatus().then(({ authRequired: required }) =>
      setAuthRequired(required),
    );
  }, []);

  if (authRequired === null) {
    return null;
  }
  if (!authRequired) {
    return <Navigate to="/chat" replace />;
  }
  return <Navigate to={getToken() ? "/chat" : "/login"} replace />;
}

function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen app-bg text-zinc-200 overflow-hidden">
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden transition-opacity"
        />
      )}
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="flex-1 flex flex-col min-w-0 min-h-0">
        <Outlet context={{ setSidebarOpen }} />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RedirectToChatOrLogin />} />
      <Route path="login" element={<Login />} />
      <Route element={<Layout />}>
        <Route path="chat" element={<Chat />} />
        <Route path="channels" element={<Channels />} />
        <Route path="schedule" element={<Schedule />} />
        <Route path="audit" element={<Audit />} />
        <Route path="safety" element={<Safety />} />
        <Route path="capabilities" element={<Capabilities />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Route>
    </Routes>
  );
}
