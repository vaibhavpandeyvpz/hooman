import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: ["localhost", "127.0.0.1"],
    watch: {
      usePolling: true,
      interval: 1000,
    },
  },
});
