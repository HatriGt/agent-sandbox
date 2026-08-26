import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// The app is served by the same express container that serves /mcp, mounted under /dashboard.
// A relative base keeps the asset URLs working from that subpath without an absolute host.
export default defineConfig({
  base: "/dashboard/",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    // `npm run dev` proxies the data routes to the deployed controller so the UI can be developed
    // against real boxes. Set ASB_API to point somewhere else. Every token-guarded route the client
    // touches must be listed — `/watch.sse` and `/artifact` were missing, so in dev the live stream
    // 404'd and silently fell back to the 3s poll, and artifact previews never loaded.
    proxy: Object.fromEntries(
      [
        "/monitor.json",
        "/watch.json",
        "/watch.sse",
        "/artifact",
        "/ask.json",
        "/resume.json",
        "/teardown.json",
        "/delegate.json",
      ].map((p) => [p, { target: process.env.ASB_API || "http://127.0.0.1:8787", changeOrigin: true }])
    ),
  },
});
