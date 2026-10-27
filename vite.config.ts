import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import coral from "@coral-ai/react/vite";

/**
 * Where the voice broker listens (server/micaLiveServer.mjs). Only the port is
 * configurable here; the host is loopback by design.
 */
const voicePort = process.env.MICA_LIVE_PORT ?? "8787";

export default defineConfig({
  plugins: [react(), coral()],
  server: {
    /*
     * Keeps voice requests same-origin in development, for both the browser and
     * the Electron dev window. That means no VITE_* backend URL is needed and
     * the renderer's connect-src can stay 'self'. A packaged Electron build has
     * no dev server, so it must be built with VITE_MICA_API_BASE_URL set.
     */
    proxy: {
      "/api/live": {
        target: `http://127.0.0.1:${voicePort}`,
        changeOrigin: false,
      },
    },
  },
});
