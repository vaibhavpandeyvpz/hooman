import type { AgentContext } from "@agentclientprotocol/sdk";
import {
  openExternalBrowser,
  type BrowserPreviewBackend,
} from "../core/utils/browser.js";

export const ACP_BROWSER_OPEN_METHOD = "_hoomanjs/browser/open";

type BrowserOpenParams = {
  sessionId: string;
  url: string;
};

/**
 * Preview backend for ACP: prefers the client's Simple Browser method when
 * available, otherwise falls back to the OS default browser.
 * Live reload is handled by the preview server (SSE), not a separate reload RPC.
 */
export function createAcpBrowserPreviewBackend(
  client: AgentContext,
  sessionId: string,
): BrowserPreviewBackend {
  return {
    async open(url: string) {
      try {
        await client.request(ACP_BROWSER_OPEN_METHOD, {
          sessionId,
          url,
        } satisfies BrowserOpenParams);
      } catch {
        await openExternalBrowser(url);
      }
    },
  };
}
