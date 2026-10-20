import { readFileSync } from "node:fs";

import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { defineConfig } from "vitest/config";

// Cesium loads its workers, textures and widget styles at runtime from a
// base URL, so they are copied next to the bundle rather than imported.
const CESIUM_BUILD = "node_modules/cesium/Build/Cesium";
const CESIUM_BASE = "cesium";
// "/" locally; "/earthpulse/" when built for GitHub Pages.
const BASE = process.env.VITE_BASE ?? "/";
// The service worker caches Cesium's files per version, so an upgrade replaces them.
const CESIUM_VERSION = (JSON.parse(readFileSync(new URL("./node_modules/cesium/package.json", import.meta.url), "utf8")) as { version: string }).version;

export default defineConfig({
  base: BASE,
  define: { CESIUM_BASE_URL: JSON.stringify(`${BASE}${CESIUM_BASE}`), CESIUM_VERSION: JSON.stringify(CESIUM_VERSION) },
  plugins: [
    react(),
    viteStaticCopy({
      targets: ["Workers", "ThirdParty", "Assets", "Widgets"].map((dir) => ({
        src: `${CESIUM_BUILD}/${dir}`,
        dest: CESIUM_BASE,
        // Drop "node_modules/cesium/Build/Cesium" so files land at /cesium/<dir>/...
        rename: { stripBase: CESIUM_BUILD.split("/").length },
      })),
    }),
  ],
  server: { port: 5173, strictPort: true },
  build: {
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      output: {
        // Cesium is most of the download and changes only when the library is upgraded. In its own
        // file it stays in returning visitors' cache across EarthPulse releases.
        manualChunks(id: string) {
          if (id.includes("node_modules/cesium") || id.includes("node_modules/@cesium")) return "cesium";
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) return "react";
          return undefined;
        },
      },
    },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
