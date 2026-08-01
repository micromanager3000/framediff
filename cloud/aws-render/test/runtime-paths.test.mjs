import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import { viteExecutablePath } from "../src/runtime-paths.mjs";

test("resolves the worker-owned Vite executable without workspace hoisting", async () => {
  const executable = viteExecutablePath();
  assert.match(executable, /cloud\/aws-render\/node_modules\/vite\/bin\/vite\.js$/);
  await access(executable);
});
