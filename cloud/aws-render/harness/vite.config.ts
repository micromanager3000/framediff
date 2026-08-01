import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const ortDist = fileURLToPath(new URL("../node_modules/onnxruntime-web/dist/", import.meta.url));

export default defineConfig({
  appType: "mpa",
  plugins: [{
    name: "framediff-ort-runtime",
    configureServer(server) {
      server.middlewares.use("/ort", async (request, response, next) => {
        const name = basename((request.url || "").split("?", 1)[0] || "");
        if (!/^ort-wasm-[A-Za-z0-9._-]+\.(mjs|wasm)$/.test(name)) return next();
        try {
          const bytes = await readFile(resolve(ortDist, name));
          response.statusCode = 200;
          response.setHeader("Content-Type", name.endsWith(".wasm") ? "application/wasm" : "text/javascript");
          response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          response.end(bytes);
        } catch {
          next();
        }
      });
    },
  }],
  optimizeDeps: {
    include: ["mp4-muxer", "onnxruntime-web/webgpu"],
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
