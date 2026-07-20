import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { fileURLToPath, URL } from "node:url";
// Relative import: vite.config.ts is bundled by esbuild before the app's alias
// config exists, so "framediff/vite" would not resolve here. App code should use
// the "framediff/vite" export instead.
import { framediffDev } from "../../packages/framediff/vite-plugin";

// Resolve the `framediff` library to its TypeScript source so Vite processes it as part of this
// app's module graph. Exact-match aliases (regex) so subpaths like "framediff/three" resolve
// independently instead of being prefix-rewritten under src/index.ts.
export default defineConfig({
  plugins: [sveltekit(), framediffDev()],
  server: { watch: { ignored: ["**/.svelte-kit/**", "**/build/**"] } },
  resolve: {
    dedupe: ["svelte"],
    alias: [
      { find: /^framediff$/, replacement: fileURLToPath(new URL("../../packages/framediff/src/index.ts", import.meta.url)) },
      { find: /^framediff\/three$/, replacement: fileURLToPath(new URL("../../packages/framediff/src/three/index.ts", import.meta.url)) },
    ],
  },
});
