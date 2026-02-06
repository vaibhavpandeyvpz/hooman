import { useState, useEffect } from "react";
import { SlidersHorizontal } from "lucide-react";
import { getChannels, patchChannels } from "../api";
import type { ChannelEntry } from "../api";
import { Button } from "./Button";
import { Checkbox } from "./Checkbox";
import { useDialog } from "./Dialog";
import { Input } from "./Input";
import { Modal } from "./Modal";
import { Select } from "./Select";

export function Channels() {
  const dialog = useDialog();
  const [channels, setChannels] = useState<Record<string, ChannelEntry> | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [configModalChannel, setConfigModalChannel] = useState<string | null>(
    null,
  );
  const [saving, setSaving] = useState<string | null>(null);

  function load() {
    getChannels()
      .then((r) => {
        setChannels(r.channels ?? {});
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleEnabled(
    id: string,
    current: ChannelEntry,
    next: boolean,
  ) {
    if (current.alwaysOn || current.config === null) return;
    const ok = await dialog.confirm({
      title: next ? "Turn on channel?" : "Turn off channel?",
      message: next
        ? `Enable ${current.name}? Incoming messages will be processed.`
        : `Disable ${current.name}? Incoming messages will no longer be processed.`,
      confirmLabel: next ? "Turn on" : "Turn off",
      variant: next ? "default" : "danger",
    });
    if (!ok) return;
    setSaving(id);
    try {
      const patch: Record<string, unknown> = {};
      if (id === "slack") patch.slack = { ...current.config, enabled: next };
      if (id === "email") patch.email = { ...current.config, enabled: next };
      if (id === "whatsapp")
        patch.whatsapp = { ...current.config, enabled: next };
      await patchChannels(patch);
      load();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(null);
    }
  }

  async function saveChannel(id: string, config: Record<string, unknown>) {
    setSaving(id);
    try {
      const patch: Record<string, unknown> = {};
      if (id === "slack") patch.slack = config;
      if (id === "email") patch.email = config;
      if (id === "whatsapp") patch.whatsapp = config;
      await patchChannels(patch);
      setConfigModalChannel(null);
      load();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col h-full min-h-0 p-4 md:p-6">
        <p className="text-hooman-muted text-sm">Loading channels…</p>
      </div>
    );
  }

  const order = ["web", "slack", "email", "whatsapp"];
  const list = order
    .map((id) => channels?.[id])
    .filter(Boolean) as ChannelEntry[];

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="border-b border-hooman-border px-4 md:px-6 py-3 md:py-4 shrink-0">
        <h2 className="text-base md:text-lg font-semibold text-white">
          Channels
        </h2>
        <p className="text-xs md:text-sm text-hooman-muted">
          Manage where Hooman receives messages (web, Slack, email). Sending is
          handled by colleagues.
        </p>
      </header>
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 min-h-0">
        {list.map((ch) => (
          <ChannelCard
            key={ch.id}
            channel={ch}
            onOpenConfigure={() => setConfigModalChannel(ch.id)}
            onToggleEnabled={(next) => toggleEnabled(ch.id, ch, next)}
            saving={saving === ch.id}
          />
        ))}
      </div>
      {configModalChannel && channels?.[configModalChannel] && (
        <ConfigModal
          channel={channels[configModalChannel]}
          onClose={() => setConfigModalChannel(null)}
          onSave={(config) => saveChannel(configModalChannel, config)}
          saving={saving === configModalChannel}
        />
      )}
    </div>
  );
}

function ChannelCard({
  channel: ch,
  onOpenConfigure,
  onToggleEnabled,
  saving,
}: {
  channel: ChannelEntry;
  onOpenConfigure: () => void;
  onToggleEnabled: (next: boolean) => void;
  saving: boolean;
}) {
  const canConfigure = !ch.alwaysOn;

  return (
    <div className="rounded-xl border border-hooman-border bg-hooman-surface overflow-hidden">
      <div className="flex items-center justify-between p-4">
        <div>
          <h3 className="font-medium text-white">{ch.name}</h3>
          {ch.alwaysOn ? (
            <p className="text-xs text-hooman-muted">Always on</p>
          ) : (
            <p className="text-xs text-hooman-muted">
              {ch.enabled ? "Enabled" : "Disabled"}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!ch.alwaysOn && (
            <Button
              type="button"
              variant={ch.enabled ? "success" : "danger"}
              size="sm"
              onClick={() => onToggleEnabled(!ch.enabled)}
              disabled={saving || ch.config === null}
            >
              {ch.enabled ? "On" : "Off"}
            </Button>
          )}
          {canConfigure && (
            <Button
              variant="secondary"
              size="sm"
              icon={<SlidersHorizontal className="w-4 h-4" />}
              onClick={onOpenConfigure}
            >
              Configure
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfigModal({
  channel,
  onClose,
  onSave,
  saving,
}: {
  channel: ChannelEntry;
  onClose: () => void;
  onSave: (config: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const config = channel.config ?? {};
  const formId = "channel-config-form";
  return (
    <Modal
      open
      onClose={onClose}
      title={`Configure ${channel.name}`}
      maxWidth="lg"
      footer={
        <div className="flex gap-2">
          <Button
            variant="success"
            type="submit"
            form={formId}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      }
    >
      {channel.id === "slack" && (
        <SlackConfigForm
          id={formId}
          config={config}
          onSave={onSave}
          saving={saving}
        />
      )}
      {channel.id === "email" && (
        <EmailConfigForm
          id={formId}
          config={config}
          onSave={onSave}
          saving={saving}
        />
      )}
      {channel.id === "whatsapp" && (
        <WhatsAppConfigForm
          id={formId}
          config={config}
          onSave={onSave}
          saving={saving}
        />
      )}
    </Modal>
  );
}

function SlackConfigForm({
  id,
  config,
  onSave,
  saving,
}: {
  id: string;
  config: Record<string, unknown>;
  onSave: (c: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const [appToken, setAppToken] = useState(String(config.appToken ?? ""));
  const [userToken, setUserToken] = useState(String(config.userToken ?? ""));
  const [designatedUserId, setDesignatedUserId] = useState(
    String(config.designatedUserId ?? ""),
  );
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
          appToken: appToken.trim() || undefined,
          userToken: userToken.trim() || undefined,
          designatedUserId: designatedUserId.trim() || undefined,
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
      <Input
        label="App token (xapp-…)"
        type="password"
        placeholder="Leave blank to keep current"
        value={appToken}
        onChange={(e) => setAppToken(e.target.value)}
      />
      <Input
        label="Bot/User token (xoxb-… / xoxp-…)"
        type="password"
        placeholder="Leave blank to keep current"
        value={userToken}
        onChange={(e) => setUserToken(e.target.value)}
      />
      <Input
        label="Designated user ID (optional)"
        value={designatedUserId}
        onChange={(e) => setDesignatedUserId(e.target.value)}
      />
      <Select
        label="Filter mode"
        value={filterMode}
        onChange={(value) => setFilterMode(value)}
        options={[
          { value: "all", label: "All" },
          { value: "allowlist", label: "Allowlist" },
          { value: "blocklist", label: "Blocklist" },
        ]}
      />
      {filterMode !== "all" && (
        <Input
          label="Filter list (comma-separated IDs)"
          placeholder="User or channel IDs"
          value={filterList}
          onChange={(e) => setFilterList(e.target.value)}
        />
      )}
    </form>
  );
}

function EmailConfigForm({
  id,
  config,
  onSave,
  saving,
}: {
  id: string;
  config: Record<string, unknown>;
  onSave: (c: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const imap = (config.imap ?? {}) as Record<string, unknown>;
  const [host, setHost] = useState(String(imap.host ?? ""));
  const [port, setPort] = useState(String(imap.port ?? "993"));
  const [user, setUser] = useState(String(imap.user ?? ""));
  const [password, setPassword] = useState(String(imap.password ?? ""));
  const [tls, setTls] = useState(imap.tls !== false);
  const [pollIntervalMinutes, setPollIntervalMinutes] = useState(
    String(Math.max(1, Math.round((config.pollIntervalMs ?? 60000) / 60000))),
  );
  const [folders, setFolders] = useState(
    Array.isArray(config.folders) ? config.folders.join(", ") : "INBOX",
  );
  const [identityAddresses, setIdentityAddresses] = useState(
    Array.isArray(config.identityAddresses)
      ? config.identityAddresses.join(", ")
      : "",
  );
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
          imap: { host, port: parseInt(port, 10) || 993, user, password, tls },
          pollIntervalMs:
            Math.max(1, parseInt(pollIntervalMinutes, 10) || 1) * 60 * 1000,
          folders: folders
            ? folders
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
          identityAddresses: identityAddresses
            ? identityAddresses
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
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
      <Input
        label="IMAP host"
        value={host}
        onChange={(e) => setHost(e.target.value)}
      />
      <Input
        label="IMAP port"
        type="number"
        value={port}
        onChange={(e) => setPort(e.target.value)}
      />
      <Input
        label="IMAP user"
        value={user}
        onChange={(e) => setUser(e.target.value)}
      />
      <Input
        label="IMAP password"
        type="password"
        placeholder="Leave blank to keep current"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Checkbox
        id="email-tls"
        checked={tls}
        onChange={setTls}
        label="Use TLS"
      />
      <Input
        label="Poll interval (minutes)"
        type="number"
        min={1}
        value={pollIntervalMinutes}
        onChange={(e) => setPollIntervalMinutes(e.target.value)}
      />
      <Input
        label="Folders (comma-separated)"
        placeholder="INBOX"
        value={folders}
        onChange={(e) => setFolders(e.target.value)}
      />
      <Input
        label="Identity addresses (To/CC/BCC, comma-separated)"
        placeholder="me@example.com"
        value={identityAddresses}
        onChange={(e) => setIdentityAddresses(e.target.value)}
      />
      <Select
        label="Filter mode"
        value={filterMode}
        onChange={(value) => setFilterMode(value)}
        options={[
          { value: "all", label: "All" },
          { value: "allowlist", label: "Allowlist" },
          { value: "blocklist", label: "Blocklist" },
        ]}
      />
      {filterMode !== "all" && (
        <Input
          label="Filter list (addresses/domains, comma-separated)"
          value={filterList}
          onChange={(e) => setFilterList(e.target.value)}
        />
      )}
    </form>
  );
}

function WhatsAppConfigForm({
  id,
  config,
  onSave,
  saving,
}: {
  id: string;
  config: Record<string, unknown>;
  onSave: (c: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const [sessionPath, setSessionPath] = useState(
    String(config.sessionPath ?? ""),
  );
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
          sessionPath: sessionPath.trim() || undefined,
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
      <Input
        label="Session path (optional)"
        placeholder="workspace/whatsapp-session"
        value={sessionPath}
        onChange={(e) => setSessionPath(e.target.value)}
      />
      <Select
        label="Filter mode"
        value={filterMode}
        onChange={(value) => setFilterMode(value)}
        options={[
          { value: "all", label: "All" },
          { value: "allowlist", label: "Allowlist" },
          { value: "blocklist", label: "Blocklist" },
        ]}
      />
      {filterMode !== "all" && (
        <Input
          label="Filter list (numbers/group IDs, comma-separated)"
          value={filterList}
          onChange={(e) => setFilterList(e.target.value)}
        />
      )}
    </form>
  );
}
