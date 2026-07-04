import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

/**
 * Builds the chat panel's SolidJS webview into `media/chat.js` + `media/chat.css`
 * — plain, unhashed filenames so `chat-view.ts#html()` can reference them
 * directly, and a single self-executing IIFE bundle (no `type="module"`,
 * no chunk splitting) so it runs as-is under the webview's strict CSP
 * (`script-src 'nonce-...'`).
 */
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [solid(), tailwindcss()],
  build: {
    outDir: "media",
    emptyOutDir: false,
    cssCodeSplit: false,
    sourcemap: true,
    lib: {
      entry: fileURLToPath(new URL("webview/main.tsx", import.meta.url)),
      formats: ["iife"],
      name: "HoomanChat",
      fileName: () => "chat.js",
      cssFileName: "chat",
    },
  },
});
