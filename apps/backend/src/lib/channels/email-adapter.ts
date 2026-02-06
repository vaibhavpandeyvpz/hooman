/**
 * Email channel adapter: IMAP poll for unseen emails, dispatch message.sent with
 * channelMeta and attachments. Inbound only. Run via cron worker (recurring job).
 */
import createDebug from "debug";
import Imap from "imap";
import { simpleParser } from "mailparser";
import type { AddressObject } from "mailparser";
import type {
  EventDispatcher,
  ChannelMeta,
  EmailChannelConfig,
} from "../core/types.js";

const debug = createDebug("hooman:email-adapter");

function getAddressList(
  obj: AddressObject | AddressObject[] | undefined,
): string[] {
  if (!obj) return [];
  const arr = Array.isArray(obj) ? obj : [obj];
  const out: string[] = [];
  for (const o of arr) {
    const val = o?.value ?? [];
    for (const v of val) if (v?.address) out.push(normalizeAddress(v.address));
  }
  return out;
}

function normalizeAddress(addr: string): string {
  return addr.trim().toLowerCase();
}

function senderFromParsed(parsed: {
  from?: { value?: Array<{ address?: string; name?: string }> };
}): { address: string; name?: string } {
  const first = parsed.from?.value?.[0];
  return {
    address: normalizeAddress(first?.address ?? ""),
    name: first?.name?.trim(),
  };
}

function applyFilter(
  config: EmailChannelConfig,
  fromAddress: string,
  fromDomain: string,
): boolean {
  const mode = config.filterMode ?? "all";
  if (mode === "all") return true;
  const list = (config.filterList ?? []).map((x) => x.trim().toLowerCase());
  const match = list.some(
    (entry) =>
      fromAddress === entry ||
      fromAddress.endsWith("@" + entry) ||
      fromDomain === entry,
  );
  if (mode === "allowlist") return match;
  return !match; // blocklist
}

function getDirectness(
  config: EmailChannelConfig,
  parsed: {
    to?: AddressObject | AddressObject[];
    cc?: AddressObject | AddressObject[];
    bcc?: AddressObject | AddressObject[];
  },
): {
  directness: "direct" | "neutral";
  directnessReason?: "to" | "cc" | "bcc";
} {
  const identities = (config.identityAddresses ?? []).map((a) =>
    normalizeAddress(a),
  );
  if (identities.length === 0) return { directness: "neutral" };

  const toList = getAddressList(parsed.to);
  const ccList = getAddressList(parsed.cc);
  const bccList = getAddressList(parsed.bcc);

  for (const id of identities) {
    if (toList.includes(id))
      return { directness: "direct", directnessReason: "to" };
    if (ccList.includes(id))
      return { directness: "direct", directnessReason: "cc" };
    if (bccList.includes(id))
      return { directness: "direct", directnessReason: "bcc" };
  }
  return { directness: "neutral" };
}

function poll(dispatcher: EventDispatcher, config: EmailChannelConfig): void {
  const { imap: imapConfig, folders } = config;
  const folderList = (folders?.length ? folders : ["INBOX"])
    .map((f) => f.trim())
    .filter(Boolean);
  if (folderList.length === 0) return;

  const imap = new Imap({
    user: imapConfig.user,
    password: imapConfig.password,
    host: imapConfig.host,
    port: imapConfig.port,
    tls: imapConfig.tls !== false,
    tlsOptions: { rejectUnauthorized: false },
  });

  imap.once("error", (err: Error) => {
    debug("IMAP error: %o", err);
  });

  imap.once("ready", () => {
    const openNext = (idx: number) => {
      if (idx >= folderList.length) {
        imap.end();
        return;
      }
      const name = folderList[idx];
      imap.openBox(name, false, (err) => {
        if (err) {
          debug("openBox %s error: %o", name, err);
          openNext(idx + 1);
          return;
        }
        imap.search(["UNSEEN"], (searchErr, uids) => {
          if (searchErr || !uids?.length) {
            openNext(idx + 1);
            return;
          }
          const fetch = imap.fetch(uids, { bodies: "" });
          const chunks: Buffer[] = [];
          fetch.on("message", (msg) => {
            msg.on("body", (stream) => {
              const parts: Buffer[] = [];
              stream.on("data", (chunk: Buffer) => parts.push(chunk));
              stream.once("end", () => chunks.push(Buffer.concat(parts)));
            });
          });
          fetch.once("error", (fetchErr: Error) => {
            debug("fetch error: %o", fetchErr);
            openNext(idx + 1);
          });
          fetch.once("end", () => {
            (async () => {
              for (const raw of chunks) {
                try {
                  const parsed = await simpleParser(raw);
                  const from = senderFromParsed(parsed);
                  if (!from.address) continue;
                  const fromDomain = from.address.includes("@")
                    ? (from.address.split("@")[1] ?? "")
                    : "";
                  if (!applyFilter(config, from.address, fromDomain)) continue;

                  const text =
                    parsed.text ??
                    (typeof parsed.html === "string"
                      ? parsed.html.replace(/<[^>]+>/g, " ").slice(0, 50_000)
                      : "");
                  const userId = `email:${from.address}`;

                  const { directness, directnessReason } = getDirectness(
                    config,
                    parsed,
                  );
                  const toStr = getAddressList(parsed.to).join(", ");
                  const channelMeta: ChannelMeta = {
                    channel: "email",
                    messageId: parsed.messageId ?? "",
                    to: toStr,
                    from: from.address,
                    fromName: from.name,
                    inReplyTo: parsed.inReplyTo,
                    references: parsed.references?.toString(),
                    directness,
                    directnessReason,
                  };
                  if (parsed.inReplyTo) {
                    channelMeta.originalMessage = {
                      from: from.address,
                      fromName: from.name,
                      messageId: parsed.inReplyTo,
                    };
                  }

                  const attachments = (parsed.attachments ?? []).map((a) => ({
                    name: a.filename ?? "attachment",
                    contentType:
                      a.contentType?.split(";")[0]?.trim() ??
                      "application/octet-stream",
                    data: Buffer.isBuffer(a.content)
                      ? a.content.toString("base64")
                      : "",
                  }));

                  await dispatcher.dispatch(
                    {
                      source: "email",
                      type: "message.sent",
                      payload: {
                        text:
                          (parsed.subject
                            ? `Subject: ${parsed.subject}\n\n`
                            : "") + text,
                        userId,
                        channelMeta,
                        ...(attachments.length ? { attachments } : {}),
                      },
                    },
                    {},
                  );
                  debug(
                    "Email message.sent dispatched: from=%s messageId=%s",
                    from.address,
                    parsed.messageId,
                  );
                } catch (e) {
                  debug("email parse/dispatch error: %o", e);
                }
              }
              if (uids.length) imap.addFlags(uids, ["\\Seen"], () => {});
            })().finally(() => openNext(idx + 1));
          });
        });
      });
    };
    openNext(0);
  });

  imap.connect();
}

/** One-shot email poll. Call from cron worker on a schedule. No-op if disabled or missing IMAP config. */
export function runEmailPoll(
  dispatcher: EventDispatcher,
  config: EmailChannelConfig | undefined,
): void {
  if (
    !config?.enabled ||
    !config.imap?.host?.trim() ||
    !config.imap?.user?.trim()
  )
    return;
  poll(dispatcher, config);
}
