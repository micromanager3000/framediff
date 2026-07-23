import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    include: ["mp4-muxer"],
  },
  resolve: {
    alias: {
      framediff: fileURLToPath(new URL("../../../packages/framediff/src/index.ts", import.meta.url)),
    },
  },
  server: {
    strictPort: true,
  },
});
