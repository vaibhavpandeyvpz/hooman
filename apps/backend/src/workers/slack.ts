/**
 * Slack worker: runs only the Slack channel adapter, posting events to API via POST /api/internal/dispatch.
 * Respects channel on/off: at startup and when Redis reload flag is set (e.g. after PATCH /api/channels).
 * Run as a separate PM2 process (e.g. pm2 start ecosystem.config.cjs --only slack).
 */
import createDebug from "debug";
import { loadPersisted, getChannelsConfig } from "../lib/core/config.js";
import { createDispatchClient } from "../lib/api/dispatch-client.js";
import {
  startSlackAdapter,
  stopSlackAdapter,
} from "../lib/channels/slack-adapter.js";
import { initRedis, closeRedis } from "../lib/data/redis.js";
import {
  initReloadWatch,
  closeReloadWatch,
} from "../lib/schedule/reload-flag.js";
import { env } from "../env.js";

const debug = createDebug("hooman:workers:slack");

async function runSlackAdapter(
  client: ReturnType<typeof createDispatchClient>,
): Promise<void> {
  await stopSlackAdapter();
  await startSlackAdapter(client, () => getChannelsConfig().slack);
}

async function main() {
  await loadPersisted();
  const client = createDispatchClient({
    apiBaseUrl: env.API_BASE_URL,
    secret: env.INTERNAL_SECRET || undefined,
  });
  await runSlackAdapter(client);

  if (env.REDIS_URL) {
    initRedis(env.REDIS_URL);
    initReloadWatch(env.REDIS_URL, ["slack"], async () => {
      debug("Reload flag set; reloading config and restarting adapter");
      await loadPersisted();
      void runSlackAdapter(client);
    });
  }

  debug("Slack worker started; posting to %s", env.API_BASE_URL);

  const shutdown = async () => {
    debug("Shutting down Slack worker…");
    await closeReloadWatch();
    await stopSlackAdapter();
    await closeRedis();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  debug("Slack worker failed: %o", err);
  process.exit(1);
});
