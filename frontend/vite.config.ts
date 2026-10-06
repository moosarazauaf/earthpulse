import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { defineConfig } from "vitest/config";

// Cesium loads its workers, textures and widget styles at runtime from a
// base URL, so they are copied next to the bundle rather than imported.
const CESIUM_BUILD = "node_modules/cesium/Build/Cesium";
const CESIUM_BASE = "cesium";
// "/" locally; "/earthpulse/" when built for GitHub Pages.
const BASE = process.env.VITE_BASE ?? "/";

export default defineConfig({
  base: BASE,
  define: { CESIUM_BASE_URL: JSON.stringify(`${BASE}${CESIUM_BASE}`) },
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
  build: { chunkSizeWarningLimit: 6000 },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
