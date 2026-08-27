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
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Split the heavy, rarely-changing vendors so the app shell arrives first and stays cached.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/react-markdown|remark-|micromark|mdast|unified|unist|hast|vfile|marked|property-information|comma-separated|space-separated|decode-named|trim-lines|bail|is-plain-obj|trough|devlop|estree|zwitch|longest-streak|ccount|escape-string|markdown-table|html-url-attributes/.test(id)) return "markdown";
          if (/\/motion\/|framer-motion|motion-dom|motion-utils/.test(id)) return "motion";
          if (/react-router/.test(id)) return "router";
          if (/@radix-ui|radix-ui/.test(id)) return "radix";
          return undefined;
        },
      },
    },
  },
  server: {
    // `npm run dev` proxies the data routes to the deployed controller so the UI can be developed
    // against real boxes. Set ASB_API to point somewhere else. Every token-guarded route the client
    // touches must be listed — `/watch.sse` and `/artifact` were missing, so in dev the live stream
    // 404'd and silently fell back to the 3s poll, and artifact previews never loaded.
    proxy: Object.fromEntries(
      [
        "/fleet.json",
        "/monitor.json",
        "/watch.json",
        "/watch.sse",
        "/artifact",
        "/files.json",
        "/inbox.json",
        "/accounts.json",
        "/repos.json",
        "/mcp-servers.json",
        "/changes.json",
        "/diff.json",
        "/pr.json",
        "/keep.json",
        "/repos",
        "/accounts",
        "/ask.json",
        "/resume.json",
        "/teardown.json",
        "/delegate.json",
      ].map((p) => [p, { target: process.env.ASB_API || "http://127.0.0.1:8787", changeOrigin: true }])
    ),
  },
});
