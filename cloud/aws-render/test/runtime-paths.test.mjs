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

test("ECR publishing uses isolated non-Keychain registry credentials", async () => {
  const publish = await readFile(resolve(import.meta.dirname, "../scripts/build-and-push.sh"), "utf8");
  assert.match(publish, /get-authorization-token/);
  assert.match(publish, /del\(\.auths, \.credsStore, \.credHelpers\)/);
  assert.match(publish, /for metadata in contexts buildx/);
  assert.match(publish, /DOCKER_CONFIG="\$DOCKER_AUTH_DIR" docker buildx build/);
  assert.doesNotMatch(publish, /docker login/);
});

test("AWS worker deployments require a production-shaped artifact canary", async () => {
  const deploy = await readFile(resolve(import.meta.dirname, "../scripts/deploy.sh"), "utf8");
  const submit = await readFile(resolve(import.meta.dirname, "../scripts/submit-hosted-smoke.sh"), "utf8");
  const verify = await readFile(resolve(import.meta.dirname, "../scripts/verify-hosted-render.sh"), "utf8");
  const hostedConfig = await readFile(resolve(import.meta.dirname, "../scripts/verify-hosted-config.sh"), "utf8");
  assert.match(deploy, /--role-arn "arn:aws:iam::\$FD_EXPECTED_ACCOUNT_ID:role\/framediff-cloud-render-cloudformation"/);
  assert.match(deploy, /"\$SCRIPT_DIR\/verify-hosted-render\.sh"/);
  assert.doesNotMatch(deploy, /SKIP_RENDER_CANARY/);
  assert.match(submit, /"src\/styles\.css"/);
  assert.match(submit, /url\(%23n\)/);
  assert.match(submit, /from: 0,\s*to: 48,/);
  assert.match(verify, /ffprobe/);
  assert.match(verify, /blackdetect/);
  assert.match(verify, /signalstats/);
  assert.match(verify, /framemd5/);
  assert.match(deploy, /verify-hosted-config\.sh/);
  assert.match(hostedConfig, /FRAMEDIFF_AWS_BATCH_JOB_DEFINITION_ARN/);
  assert.match(hostedConfig, /FRAMEDIFF_RENDER_WORKER_IMAGE_DIGEST/);
  assert.match(hostedConfig, /FRAMEDIFF_RENDER_FRAMEDIFF_REVISION/);
});

test("routine AWS access uses renewable scoped machine credentials", async () => {
  const common = await readFile(resolve(import.meta.dirname, "../scripts/common.sh"), "utf8");
  const bootstrap = await readFile(resolve(import.meta.dirname, "../scripts/bootstrap-machine-auth.sh"), "utf8");
  const authTemplate = await readFile(resolve(import.meta.dirname, "../auth-template.yaml"), "utf8");
  assert.match(common, /FD_AWS_PROFILE="\$\{FD_AWS_PROFILE:-framediff-machine\}"/);
  assert.match(common, /assumed-role\/framediff-cloud-render-machine/);
  assert.match(bootstrap, /aws_signing_helper credential-process/);
  assert.match(bootstrap, /--session-duration 3600/);
  assert.match(bootstrap, /FD_MACHINE_CERTIFICATE_ONLY/);
  assert.doesNotMatch(bootstrap, /aws_access_key_id|aws_secret_access_key/i);
  assert.match(authTemplate, /AWS::RolesAnywhere::TrustAnchor/);
  assert.match(authTemplate, /AWS::RolesAnywhere::Profile/);
  assert.match(authTemplate, /aws:PrincipalTag\/x509Subject\/CN/);
  assert.match(authTemplate, /DurationSeconds: 3600/);
  assert.match(authTemplate, /ecr:BatchGetImage/);
});

test("Linux cloud capture is normalized to a validated H.264 MP4", async () => {
  const harness = await readFile(resolve(import.meta.dirname, "../harness/main.ts"), "utf8");
  const runner = await readFile(resolve(import.meta.dirname, "../src/run-job.mjs"), "utf8");
  const dockerfile = await readFile(resolve(import.meta.dirname, "../Dockerfile"), "utf8");
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
  assert.match(runner, /normalizeHostedVideo/);
  assert.match(runner, /FrameDiff WebCodecs capture \+ FFmpeg H\.264 MP4 normalization/);
  assert.match(dockerfile, /apt-get install -y --no-install-recommends ffmpeg google-chrome-stable/);
  assert.match(dockerfile, /command -v ffmpeg/);
  assert.doesNotMatch(dockerfile, /^\s+(?:libav\w+|libcjson1|libopenexr\S+|libpostproc\S+|librist\S+|libsw\w+|libzvbi\S+)\s+\\$/m);
});

test("hosted cloud rendering injects the same project CSS used by Studio", async () => {
  const harness = await readFile(resolve(import.meta.dirname, "../harness/main.ts"), "utf8");
  const hostedSource = await readFile(resolve(import.meta.dirname, "../harness/hosted-source.mjs"), "utf8");
  assert.match(harness, /path\.toLowerCase\(\)\.endsWith\("\.css"\)/);
  assert.match(harness, /source: withProjectStyles\(decoder\.decode\(bytes\), projectStyles\)/);
  assert.match(hostedSource, /stripBundledStylesheetLinks/);
  assert.match(hostedSource, /pathname\.endsWith\("\.css"\)/);
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
