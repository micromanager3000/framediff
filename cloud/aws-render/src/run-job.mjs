import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { chromium } from "playwright";
import { validateJobSpec } from "./job-spec.mjs";

const workspace = process.env.FD_WORKSPACE || resolve(import.meta.dirname, "../../..");
const bucket = process.env.FD_ARTIFACT_BUCKET || "";
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-west-2";
const batchJobId = process.env.AWS_BATCH_JOB_ID || `local-${Date.now()}`;
const localOutputDir = process.env.FD_LOCAL_OUTPUT_DIR || resolve(workspace, "out/aws-render", batchJobId);
const s3 = bucket ? new S3Client({ region }) : null;
const jobPrefixDefault = `jobs/${batchJobId}`;

function log(message, detail) {
  const suffix = detail == null ? "" : ` ${typeof detail === "string" ? detail : JSON.stringify(detail)}`;
  process.stdout.write(`[framediff-cloud] ${message}${suffix}\n`);
}

async function streamToString(stream) {
  return stream.transformToString();
}

async function loadSpec() {
  if (process.env.FD_JOB_SPEC_JSON) {
    return validateJobSpec(JSON.parse(process.env.FD_JOB_SPEC_JSON));
  }
  const key = process.env.FD_JOB_SPEC_S3_KEY;
  if (key) {
    if (!s3 || !bucket) throw new Error("FD_ARTIFACT_BUCKET is required with FD_JOB_SPEC_S3_KEY.");
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return validateJobSpec(JSON.parse(await streamToString(object.Body)));
  }
  return validateJobSpec({ version: 1, kind: "capability-suite" });
}

async function putArtifact(key, body, contentType) {
  const bytes = typeof body === "string" ? Buffer.from(body) : body;
  await mkdir(localOutputDir, { recursive: true });
  await writeFile(resolve(localOutputDir, key.replaceAll("/", "__")), bytes);
  if (s3 && bucket) {
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
      ServerSideEncryption: "AES256",
    }));
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: workspace,
      env: { ...process.env, ...options.env },
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolvePromise({ stdout: stdout.trim(), stderr: stderr.trim() });
      else reject(new Error(`${command} exited ${code ?? signal}${stderr ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

async function commandDiagnostic(command, args) {
  try {
    const result = await runCommand(command, args, { capture: true });
    return { ok: true, output: result.stdout || result.stderr };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function waitForUrl(url, timeoutMs = 120_000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function chromeLaunchOptions() {
  const executablePath = process.env.FD_CHROME_PATH;
  const args = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--ignore-gpu-blocklist",
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan,UseSkiaRenderer,WebGPU,CanvasOopRasterization",
  ];
  if (process.platform === "linux") {
    args.push("--use-angle=vulkan", "--use-vulkan=native", "--disable-vulkan-surface");
  }
  return {
    headless: true,
    ...(executablePath ? { executablePath } : { channel: "chrome" }),
    args,
  };
}

async function evaluateCapabilitySuite(page) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.waitForLoadState("networkidle");
    await page.waitForFunction(() => typeof window.__runFrameDiffCloudSuite === "function");
    await page.waitForTimeout(1_500);
    try {
      return await page.evaluate(() => window.__runFrameDiffCloudSuite());
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("Execution context was destroyed") || attempt === 3) throw error;
      log("harness reloaded during dependency optimization; retrying", { attempt });
    }
  }
  throw lastError;
}

async function runCapabilitySuite(prefix) {
  const diagnostics = {
    nvidiaSmi: await commandDiagnostic("nvidia-smi", [
      "--query-gpu=name,uuid,driver_version,memory.total",
      "--format=csv,noheader",
    ]),
    ffmpeg: await commandDiagnostic("ffmpeg", ["-version"]),
    chrome: await commandDiagnostic(process.env.FD_CHROME_PATH || "google-chrome", ["--version"]),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
  };
  log("diagnostics", diagnostics);
  if (!diagnostics.nvidiaSmi.ok && process.env.FD_REQUIRE_NVIDIA !== "0") {
    throw new Error(`NVIDIA GPU diagnostics failed: ${diagnostics.nvidiaSmi.error}`);
  }

  const port = Number(process.env.FD_HARNESS_PORT || 4179);
  const url = `http://127.0.0.1:${port}`;
  const vite = spawn("node", [
    resolve(workspace, "node_modules/vite/bin/vite.js"),
    "--config", resolve(workspace, "cloud/aws-render/harness/vite.config.ts"),
    "--host", "127.0.0.1",
    "--port", String(port),
  ], {
    cwd: resolve(workspace, "cloud/aws-render/harness"),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  vite.stdout.on("data", (chunk) => process.stdout.write(`[vite] ${chunk}`));
  vite.stderr.on("data", (chunk) => process.stderr.write(`[vite] ${chunk}`));

  let browser;
  try {
    await waitForUrl(url);
    browser = await chromium.launch(chromeLaunchOptions());
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) {
        browserErrors.push(`console: ${message.text()}`);
      }
    });
    page.on("response", (response) => {
      if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) {
        browserErrors.push(`http ${response.status()}: ${response.url()}`);
      }
    });
    await page.goto(url, { waitUntil: "networkidle" });
    const report = await evaluateCapabilitySuite(page);
    report.worker = {
      batchJobId,
      region,
      imageRevision: process.env.FD_IMAGE_REVISION || "unknown",
      diagnostics,
      browserErrors,
    };
    if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join(" | ")}`);

    for (const artifactName of report.artifactNames) {
      const artifact = await page.evaluate((name) => window.__readFrameDiffCloudArtifact(name), artifactName);
      await putArtifact(`${prefix}/artifacts/${artifactName}`, Buffer.from(artifact.base64, "base64"), artifact.contentType);
    }
    await putArtifact(`${prefix}/report.json`, JSON.stringify(report, null, 2), "application/json");
    return report;
  } finally {
    await browser?.close().catch(() => {});
    vite.kill("SIGTERM");
  }
}

async function writeStatus(prefix, status, extra = {}) {
  const record = {
    version: 1,
    jobId: batchJobId,
    status,
    updatedAt: new Date().toISOString(),
    ...extra,
  };
  await putArtifact(`${prefix}/status.json`, JSON.stringify(record, null, 2), "application/json");
}

async function main() {
  const spec = await loadSpec();
  const prefix = spec.outputPrefix || jobPrefixDefault;
  await writeStatus(prefix, "RUNNING", { spec });
  try {
    const report = await runCapabilitySuite(prefix);
    await writeStatus(prefix, "SUCCEEDED", {
      reportKey: `${prefix}/report.json`,
      artifactsPrefix: `${prefix}/artifacts/`,
      resultCount: report.results.length,
    });
    log("job succeeded", { prefix, resultCount: report.results.length });
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    await writeStatus(prefix, "FAILED", { error: message }).catch((statusError) => {
      log("failed to upload failure status", statusError instanceof Error ? statusError.message : String(statusError));
    });
    throw error;
  }
}

await main();
