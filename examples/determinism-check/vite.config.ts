import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { fileURLToPath, URL } from "node:url";

// Resolve the `framediff` library to its TypeScript source (see frontend for why).
export default defineConfig({
  plugins: [sveltekit()],
  server: { watch: { ignored: ["**/.svelte-kit/**", "**/build/**"] } },
  resolve: {
    dedupe: ["svelte"],
    alias: {
      framediff: fileURLToPath(new URL("../../packages/framediff/src/index.ts", import.meta.url)),
    },
  },
});
