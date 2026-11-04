import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const api = "http://localhost:5183";

// Normal build: served by the API from wwwroot. Demo build: static files for GitHub Pages, with bundled mock data.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === "demo" ? "/courier-ops-dashboard/" : "/",
  define: { __DEMO__: JSON.stringify(mode === "demo") },
  build: {
    outDir: mode === "demo" ? "dist-demo" : "../api/Harbour.Ops.Api/wwwroot",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": api,
      "/hubs": { target: api, ws: true },
    },
  },
  test: {
    environment: "jsdom",
  },
}));
