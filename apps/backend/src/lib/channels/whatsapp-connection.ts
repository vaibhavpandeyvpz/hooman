/**
 * In-memory store for WhatsApp connection state (QR + status) so the API can serve it to the
 * frontend. The WhatsApp worker POSTs updates here via /api/internal/whatsapp-connection.
 */
export type WhatsAppConnectionStatus = "disconnected" | "pairing" | "connected";

let status: WhatsAppConnectionStatus = "disconnected";
let qr: string | undefined;

export function getWhatsAppConnection(): {
  status: WhatsAppConnectionStatus;
  qr?: string;
} {
  return { status, qr };
}

export function setWhatsAppConnection(update: {
  status: WhatsAppConnectionStatus;
  qr?: string;
}): void {
  status = update.status;
  qr = update.status === "pairing" ? update.qr : undefined;
}
