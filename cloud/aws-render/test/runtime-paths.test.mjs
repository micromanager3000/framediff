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

test("Linux cloud rendering negotiates software VP9 WebM when hardware MP4 encoders are unavailable", async () => {
  const harness = await readFile(resolve(import.meta.dirname, "../harness/main.ts"), "utf8");
  const encoder = await readFile(
    resolve(import.meta.dirname, "../../../packages/framediff/src/render/encodeWorker.ts"),
    "utf8",
  );
  assert.match(harness, /vp09\.00\.10\.08/);
  assert.match(harness, /container: "webm"/);
  assert.match(harness, /\["prefer-hardware", "no-preference"\]/);
  assert.match(harness, /hardwareAcceleration: video\.hardwareAcceleration/);
  assert.match(encoder, /new WebMOutputFormat\(\)/);
  assert.match(encoder, /codec: "vp9"/);
});
