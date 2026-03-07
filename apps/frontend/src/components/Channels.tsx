import { useState, useEffect, useCallback } from "react";
import createDebug from "debug";
import {
  SlidersHorizontal,
  FileJson,
  CheckCircle2,
  Smartphone,
  Loader2,
  LogOut,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  getChannels,
  patchChannels,
  getWhatsAppConnection,
  logoutWhatsApp,
  getSlackConversations,
  getWhatsAppChats,
  getWhatsAppContacts,
  type SlackConversation,
  type SlackConversationType,
} from "../api";

const debug = createDebug("hooman:Channels");

/** Slack app manifest for creating an app with Socket Mode and scopes required by Hooman. */
const SLACK_APP_MANIFEST = {
  _metadata: { major_version: 1 },
  display_information: {
    name: "Hooman",
    description:
      "Inbound Slack channel for Hooman. Receives messages in DMs, channels, and groups.",
    background_color: "#1a1a2e",
  },
  features: {
    bot_user: {
      display_name: "Hooman",
      always_online: false,
    },
  },
  oauth_config: {
    scopes: {
      bot: [
        "app_mentions:read",
        "channels:history",
        "channels:read",
        "groups:history",
        "groups:read",
        "im:history",
        "im:read",
        "im:write",
        "mpim:history",
        "mpim:read",
        "mpim:write",
        "users:read",
        "chat:write",
        "usergroups:read",
        "usergroups:write",
      ],
      user: [
        "channels:history",
        "channels:read",
        "groups:history",
        "groups:read",
        "im:history",
        "im:read",
        "im:write",
        "mpim:history",
        "mpim:read",
        "mpim:write",
        "users:read",
        "chat:write",
        "search:read",
        "usergroups:read",
        "usergroups:write",
      ],
    },
  },
  settings: {
    event_subscriptions: {
      user_events: [
        "message.channels",
        "message.groups",
        "message.im",
        "message.mpim",
      ],
      bot_events: [
        "message.channels",
        "message.groups",
        "message.im",
        "message.mpim",
      ],
    },
    org_deploy_enabled: false,
    socket_mode_enabled: true,
    token_rotation_enabled: false,
  },
} as const;
import type { ChannelEntry } from "../api";
import { Button } from "./Button";
import { useDialog } from "./Dialog";
import { Modal } from "./Modal";
import { SlackConfigForm, type SlackConfigFormProps } from "./SlackConfigForm";
import {
  WhatsAppConfigForm,
  type WhatsAppConfigFormProps,
} from "./WhatsAppConfigForm";
import { PageHeader } from "./PageHeader";

export function Channels() {
  const dialog = useDialog();
  const [channels, setChannels] = useState<Record<string, ChannelEntry> | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [configModalChannel, setConfigModalChannel] = useState<string | null>(
    null,
  );
  const [slackManifestOpen, setSlackManifestOpen] = useState(false);
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
      if (id === "whatsapp")
        patch.whatsapp = { ...current.config, enabled: next };
      await patchChannels(patch);
      load();
    } catch (e) {
      debug("%o", e);
    } finally {
      setSaving(null);
    }
  }

  async function saveChannel(id: string, config: Record<string, unknown>) {
    setSaving(id);
    try {
      const patch: Record<string, unknown> = {};
      if (id === "slack") patch.slack = config;
      if (id === "whatsapp") patch.whatsapp = config;
      await patchChannels(patch);
      setConfigModalChannel(null);
      load();
    } catch (e) {
      debug("%o", e);
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

  const order = ["web", "slack", "whatsapp"];
  const list = order
    .map((id) => channels?.[id])
    .filter(Boolean) as ChannelEntry[];

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader
        title="Channels"
        subtitle="Manage where Hooman receives messages (web, Slack, WhatsApp)."
      />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 min-h-0">
        {list.map((ch) => (
          <ChannelCard
            key={ch.id}
            channel={ch}
            onOpenConfigure={() => setConfigModalChannel(ch.id)}
            onOpenManifest={
              ch.id === "slack" ? () => setSlackManifestOpen(true) : undefined
            }
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
      {slackManifestOpen && (
        <SlackManifestModal onClose={() => setSlackManifestOpen(false)} />
      )}
    </div>
  );
}

function ChannelCard({
  channel: ch,
  onOpenConfigure,
  onOpenManifest,
  onToggleEnabled,
  saving,
}: {
  channel: ChannelEntry;
  onOpenConfigure: () => void;
  onOpenManifest?: () => void;
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
          {onOpenManifest && (
            <Button
              variant="secondary"
              size="sm"
              icon={<FileJson className="w-4 h-4" />}
              onClick={onOpenManifest}
            >
              Manifest
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function SlackManifestModal({ onClose }: { onClose: () => void }) {
  const manifestJson = JSON.stringify(SLACK_APP_MANIFEST, null, 2);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(manifestJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Slack app manifest"
      maxWidth="2xl"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={copy}>
            {copied ? "Copied!" : "Copy to clipboard"}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <p className="text-sm text-hooman-muted mb-3">
        Create a Slack app from this manifest to get the right scopes for Hooman
        (Socket Mode, read messages in channels/DMs/groups). In Slack: Create an
        app → From an app manifest → paste the JSON below. Then create an
        App-level token with{" "}
        <code className="text-xs bg-hooman-muted/20 px-1 rounded">
          connections:write
        </code>{" "}
        and install the app to get the User OAuth token.
      </p>
      <pre className="text-xs text-zinc-400 bg-hooman-muted/10 border border-hooman-border rounded-lg p-4 overflow-x-auto overflow-y-auto max-h-[60vh] font-mono whitespace-pre-wrap select-text">
        {manifestJson}
      </pre>
    </Modal>
  );
}

type WhatsAppConnection = {
  status: "disconnected" | "pairing" | "connected";
  qr?: string;
  selfId?: string;
  selfNumber?: string;
};

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
  const [whatsAppConn, setWhatsAppConn] = useState<WhatsAppConnection | null>(
    null,
  );
  const isWhatsApp = channel.id === "whatsapp";

  const fetchWhatsAppConnection = useCallback(async () => {
    const data = await getWhatsAppConnection();
    setWhatsAppConn(data);
  }, []);

  useEffect(() => {
    if (!isWhatsApp || !channel.enabled) return;
    void fetchWhatsAppConnection();
    const t = setInterval(fetchWhatsAppConnection, 2500);
    return () => clearInterval(t);
  }, [isWhatsApp, channel.enabled, fetchWhatsAppConnection]);

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
      {isWhatsApp && (
        <WhatsAppConnectionBlock
          connection={whatsAppConn}
          enabled={!!channel.enabled}
          onLogout={fetchWhatsAppConnection}
        />
      )}
      {channel.id === "slack" && (
        <div className="mb-6">
          {!channel.enabled ? (
            <div className="rounded-xl border border-hooman-border bg-hooman-surface p-4">
              <div className="flex items-center gap-2 text-sm text-hooman-muted">
                <SlidersHorizontal className="h-4 w-4 shrink-0" />
                <p>Enable the channel and save to link your Slack workspace.</p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-hooman-border bg-hooman-surface overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-hooman-border/50 px-4 py-3">
                <h4 className="text-sm font-medium text-white">
                  Link workspace
                </h4>
                {(config.agentIdentity as string)?.trim() ? (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-hooman-green/40 bg-hooman-green/10 px-2 py-0.5 text-xs font-medium text-hooman-green">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Linked
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-hooman-border bg-hooman-border/20 px-2 py-0.5 text-xs font-medium text-hooman-muted">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Connecting
                  </span>
                )}
              </div>
              {(config.agentIdentity as string)?.trim() && (
                <div className="p-4">
                  <p className="text-sm text-zinc-300">
                    Connected as{" "}
                    <span className="font-mono text-zinc-100">
                      {String(config.agentIdentity).trim()}
                    </span>
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {channel.id === "slack" && (
        <SlackConfigForm
          {...({
            id: formId,
            config,
            onSave,
            saving,
            fetchFilterTabs: (config.agentIdentity as string)?.trim()
              ? async () => {
                  const { conversations } = await getSlackConversations();
                  const channelTabTypes = new Set<SlackConversationType>([
                    "channel",
                    "private",
                    "dm",
                    "mpim",
                  ]);
                  const toOpt = (c: SlackConversation) => ({
                    value: c.id,
                    label:
                      c.type === "user"
                        ? c.name
                        : c.type === "dm"
                          ? `${c.name} (DM)`
                          : c.type === "mpim"
                            ? c.name
                            : c.type === "channel" || c.type === "private"
                              ? `#${c.name}`
                              : c.name,
                  });
                  const byLabel = (
                    a: { label: string },
                    b: { label: string },
                  ) =>
                    a.label.localeCompare(b.label, undefined, {
                      sensitivity: "base",
                    });
                  const users = conversations
                    .filter((c) => c.type === "user")
                    .map(toOpt)
                    .sort(byLabel);
                  const channelOpts = conversations
                    .filter((c) => channelTabTypes.has(c.type))
                    .map(toOpt)
                    .sort(byLabel);
                  return [
                    { label: "Users", options: users },
                    { label: "Channels", options: channelOpts },
                  ];
                }
              : undefined,
          } as SlackConfigFormProps)}
        />
      )}
      {channel.id === "whatsapp" && (
        <WhatsAppConfigForm
          {...({
            id: formId,
            config,
            onSave,
            saving,
            fetchFilterTabs:
              whatsAppConn?.status === "connected"
                ? async () => {
                    const [chatsRes, contactsRes] = await Promise.all([
                      getWhatsAppChats(),
                      getWhatsAppContacts(),
                    ]);
                    const chats = chatsRes.chats;
                    const contacts = contactsRes.contacts;
                    const chatOpts = chats
                      .filter((c) => !c.isGroup)
                      .map((c) => ({ value: c.id, label: c.name || c.id }));
                    const groupOpts = chats
                      .filter((c) => c.isGroup)
                      .map((c) => ({
                        value: c.id,
                        label: `Group: ${c.name || c.id}`,
                      }));
                    const contactOpts = contacts.map((c) => ({
                      value: c.id,
                      label: c.name || c.id,
                    }));
                    return [
                      { label: "Chats", options: chatOpts },
                      { label: "Contacts", options: contactOpts },
                      { label: "Groups", options: groupOpts },
                    ];
                  }
                : undefined,
          } as WhatsAppConfigFormProps)}
        />
      )}
    </Modal>
  );
}

function WhatsAppConnectionBlock({
  connection,
  enabled,
  onLogout,
}: {
  connection: WhatsAppConnection | null;
  enabled: boolean;
  onLogout?: () => void;
}) {
  const [loggingOut, setLoggingOut] = useState(false);
  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logoutWhatsApp();
      onLogout?.();
    } catch {
      setLoggingOut(false);
    } finally {
      setLoggingOut(false);
    }
  };

  if (!enabled) {
    return (
      <div className="mb-6 rounded-xl border border-hooman-border bg-hooman-surface p-4">
        <div className="flex items-center gap-2 text-sm text-hooman-muted">
          <Smartphone className="h-4 w-4 shrink-0" />
          <p>
            Enable the channel and save to start linking your WhatsApp device.
          </p>
        </div>
      </div>
    );
  }

  const status = connection?.status ?? "disconnected";
  return (
    <div className="mb-6 rounded-xl border border-hooman-border bg-hooman-surface overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-hooman-border/50 px-4 py-3">
        <h4 className="text-sm font-medium text-white">Link device</h4>
        {status === "connected" && (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-hooman-green/40 bg-hooman-green/10 px-2 py-0.5 text-xs font-medium text-hooman-green">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Linked
          </span>
        )}
        {status === "pairing" && (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400">
            <Smartphone className="h-3.5 w-3.5" />
            Scan QR
          </span>
        )}
        {(status === "disconnected" || (!connection && enabled)) && (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-hooman-border bg-hooman-border/20 px-2 py-0.5 text-xs font-medium text-hooman-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Connecting
          </span>
        )}
      </div>
      <div className="p-4">
        {status === "connected" && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-zinc-300">
              {connection?.selfNumber || connection?.selfId ? (
                <>
                  Connected as{" "}
                  <span className="font-mono text-zinc-100">
                    {connection.selfNumber ?? connection.selfId}
                  </span>
                </>
              ) : (
                <>WhatsApp is linked and receiving messages.</>
              )}
            </p>
            <Button
              variant="danger"
              size="sm"
              icon={<LogOut className="h-4 w-4" />}
              onClick={handleLogout}
              disabled={loggingOut}
            >
              {loggingOut ? "Disconnecting…" : "Disconnect"}
            </Button>
          </div>
        )}
        {status === "pairing" && connection?.qr && (
          <div className="flex flex-col items-center gap-4">
            <p className="text-center text-sm text-hooman-muted">
              Open WhatsApp on your phone → Linked devices → Link a device, then
              scan this code.
            </p>
            <div className="rounded-xl border border-hooman-border bg-white p-4 shadow-sm">
              <QRCodeSVG value={connection.qr} size={240} level="M" />
            </div>
          </div>
        )}
        {(status === "disconnected" || (!connection && enabled)) && (
          <p className="text-sm text-hooman-muted">
            Starting connection… Ensure the WhatsApp worker is running.
          </p>
        )}
      </div>
    </div>
  );
}
