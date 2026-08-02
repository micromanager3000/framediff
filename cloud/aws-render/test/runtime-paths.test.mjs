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
  assert.match(harness, /probeVideoCodec\("vp09\.00\.10\.08", true\)/);
  assert.match(harness, /probeVideoCodec\("av01\.0\.08M\.08", false\)/);
  assert.match(harness, /hardwareAcceleration: video\.hardwareAcceleration/);
  assert.match(encoder, /new WebMOutputFormat\(\)/);
  assert.match(encoder, /codec: "vp9"/);
});

test("the background-removal smoke uses a human portrait by default", async () => {
  const harness = await readFile(resolve(import.meta.dirname, "../harness/main.ts"), "utf8");
  const submit = await readFile(resolve(import.meta.dirname, "../scripts/submit.sh"), "utf8");
  assert.match(submit, /background-removal.*lighthouseVisitor\.image/s);
  assert.match(submit, /sha256-4df193a3afb22d291cd39e35d0ef3c2b86bb4a8ef06de7ef9eb6479162da24ec\.png/);
  assert.match(harness, /Math\.min\(1, 512 \/ Math\.max\(canvas\.width, canvas\.height\)\)/);
  assert.doesNotMatch(harness, /Float32Array\(\[0\.25\]\)/);
  assert.match(harness, /executionProviders: \["wasm"\]/);
  assert.match(harness, /ort\.env\.wasm\.numThreads = 1/);
  const dockerfile = await readFile(resolve(import.meta.dirname, "../Dockerfile"), "utf8");
  assert.match(dockerfile, /cloud\/aws-render\/node_modules\/onnxruntime-web\/dist\/\*\.wasm/);
});
