import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);

/** Resolve Vite from the worker package, independent of workspace hoisting. */
export function viteExecutablePath() {
  return resolve(dirname(require.resolve("vite/package.json")), "bin/vite.js");
}
