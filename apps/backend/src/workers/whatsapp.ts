/**
 * WhatsApp worker: runs only the WhatsApp channel adapter when implemented.
 * Run as a separate PM2 process (e.g. pm2 start ecosystem.config.cjs --only whatsapp).
 * Stub: exits until an adapter is implemented.
 */
import createDebug from "debug";
import { loadPersisted } from "../lib/core/config.js";

const debug = createDebug("hooman:workers:whatsapp");

async function main() {
  await loadPersisted();
  debug("WhatsApp worker: no adapter implemented yet; process running idle.");
  const shutdown = () => {
    debug("Shutting down WhatsApp worker…");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("WhatsApp worker failed:", err);
  process.exit(1);
});
