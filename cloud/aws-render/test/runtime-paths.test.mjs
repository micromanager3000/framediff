import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { viteExecutablePath } from "../src/runtime-paths.mjs";

test("resolves the worker-owned Vite executable without workspace hoisting", async () => {
  const executable = viteExecutablePath();
  assert.match(executable, /cloud\/aws-render\/node_modules\/vite\/bin\/vite\.js$/);
  await access(executable);
});

test("the worker image includes the root TypeScript configuration required by Vite", async () => {
  const dockerfile = await readFile(resolve(import.meta.dirname, "../Dockerfile"), "utf8");
  assert.match(dockerfile, /^COPY tsconfig\.base\.json \.\/$/m);
  assert.match(dockerfile, /test -f tsconfig\.base\.json/);
});
