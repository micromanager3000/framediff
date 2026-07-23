import {
  captureCompositeFrame,
  combineCompositionSetups,
  createClothSetup,
  createScene3DRenderer,
  defineComposition,
  exportVideo,
  registerCanvasCapture,
  type CompositionConfig,
  type CompositionRegistry,
  type CompositionSetup,
  type Plane3DParams,
} from "framediff";

type Artifact = {
  contentType: string;
  bytes: Uint8Array;
};

type CapabilityResult = {
  name: string;
  durationMs: number;
  deterministic?: boolean;
  hash?: string;
  bytes?: number;
  detail?: Record<string, unknown>;
};

const artifacts = new Map<string, Artifact>();

const domSource = `<!doctype html>
<html><head><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}
[data-fd-composition]{position:relative;overflow:hidden;background:#090b12;color:#f7f4ea;font-family:Arial,sans-serif}
.grid{position:absolute;inset:0;background-image:linear-gradient(#7ce2ff18 1px,transparent 1px),linear-gradient(90deg,#7ce2ff18 1px,transparent 1px);background-size:24px 24px}
.orb{position:absolute;width:150px;height:150px;border-radius:50%;left:calc(42px + var(--fd-frame) * 4px);top:78px;background:radial-gradient(circle at 30% 25%,#fff,#77e1ff 18%,#6547ff 52%,#151329 72%);box-shadow:0 0 70px #6547ff99}
.title{position:absolute;left:34px;bottom:34px;font-weight:900;font-size:52px;letter-spacing:-.055em}
.title span{color:#77e1ff}.meter{position:absolute;right:34px;bottom:39px;width:180px;height:8px;border:1px solid #77e1ff;padding:2px}
.meter::after{content:"";display:block;height:100%;width:calc((var(--fd-frame) + 1) / 30 * 100%);background:#77e1ff}
</style></head><body>
<main data-fd-composition data-fd-id="CloudDom" data-fd-width="640" data-fd-height="360" data-fd-fps="30" data-fd-duration="30">
  <div class="grid"></div><div class="orb"></div>
  <div class="title">Frame<span>Diff</span> Cloud</div><div class="meter"></div>
</main></body></html>`;

const childSource = `<!doctype html>
<html><head><style>
html,body{margin:0}.child{position:relative;width:320px;height:180px;background:linear-gradient(135deg,#ff795e,#ffd36c);overflow:hidden}
.child::after{content:"NESTED";position:absolute;inset:auto 18px 15px auto;font:900 34px Arial;color:#19131b}
.dot{position:absolute;width:54px;height:54px;border-radius:50%;left:calc(18px + var(--fd-frame) * 5px);top:42px;background:#19131b}
</style></head><body>
<main class="child" data-fd-composition data-fd-id="CloudChild" data-fd-width="320" data-fd-height="180" data-fd-fps="30" data-fd-duration="30"><div class="dot"></div></main>
</body></html>`;

const nestedSource = `<!doctype html>
<html><head><style>
html,body{margin:0}[data-fd-composition]{position:relative;overflow:hidden;background:#12141e}
.nested{position:absolute;left:80px;top:45px;width:480px;height:270px;border:2px solid #fff3;box-shadow:0 24px 60px #0008}
</style></head><body>
<main data-fd-composition data-fd-id="CloudNested" data-fd-width="640" data-fd-height="360" data-fd-fps="30" data-fd-duration="30">
  <div class="nested" data-fd-comp="child" data-fd-nested-scale="1.5"></div>
</main></body></html>`;

const mediaSource = `<!doctype html>
<html><head><style>
html,body{margin:0}[data-fd-composition]{position:relative;overflow:hidden;background:#06070b}
video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.wash{position:absolute;inset:0;background:linear-gradient(90deg,#3014a677,transparent 55%);mix-blend-mode:screen}
.label{position:absolute;left:24px;bottom:22px;padding:8px 11px;background:#000b;color:white;font:700 18px Arial}
</style></head><body>
<main data-fd-composition data-fd-id="CloudMedia" data-fd-width="640" data-fd-height="360" data-fd-fps="30" data-fd-duration="30">
  <video src="/fixtures/synthetic.mp4" data-fd-volume="0"></video>
  <audio src="/fixtures/synthetic.wav" data-fd-volume=".35"></audio>
  <div class="wash"></div><div class="label">EXACT VIDEO + AUDIO</div>
</main></body></html>`;

const gpuSource = `<!doctype html>
<html><head><style>
html,body{margin:0}[data-fd-composition]{position:relative;overflow:hidden;background:radial-gradient(circle at 50% 45%,#23305b,#080a12 65%)}
canvas{position:absolute;inset:0;width:100%;height:100%}.label{position:absolute;left:22px;top:18px;color:#b9f5ff;font:700 15px Arial;letter-spacing:.13em}
</style></head><body>
<main data-fd-composition data-fd-id="CloudGpu" data-fd-width="640" data-fd-height="360" data-fd-fps="30" data-fd-duration="30">
  <canvas data-fd-id="gpu-scene"></canvas><div class="label">WEBGPU · L4</div>
</main></body></html>`;

const clothSource = `<!doctype html>
<html><head><style>
html,body{margin:0}[data-fd-composition]{position:relative;overflow:hidden;background:#0a0c0b}
.poster{position:absolute;left:150px;top:65px;width:340px;height:230px;background:linear-gradient(135deg,#d8ff52 0 55%,#ff684e 55%);color:#10120f;font:900 55px/.82 Arial;padding:24px;box-shadow:0 22px 50px #0009}
.poster::after{content:"CLOTH";display:block}.cloth{position:absolute;inset:0;width:100%;height:100%}
</style></head><body>
<main data-fd-composition data-fd-id="CloudCloth" data-fd-width="640" data-fd-height="360" data-fd-fps="30" data-fd-duration="30">
  <div class="poster" id="cloth-poster">HTML<br>TO</div>
  <canvas class="cloth" data-fd-cloth data-fd-cloth-source="#cloth-poster" data-fd-cloth-segments-x="12" data-fd-cloth-segments-y="8" data-fd-cloth-substeps="2" data-fd-cloth-iterations="4"></canvas>
</main></body></html>`;

const gpuSetup: CompositionSetup = async ({ query, onFrame, onCleanup }) => {
  const canvas = query<HTMLCanvasElement>("[data-fd-id='gpu-scene']");
  if (!canvas) throw new Error("GPU capability canvas is missing.");
  canvas.width = 640;
  canvas.height = 360;
  const renderer = await createScene3DRenderer(canvas, 640, 360);
  if (!renderer) throw new Error("WebGPU adapter unavailable to FrameDiff.");

  const source = document.createElement("canvas");
  source.width = 640;
  source.height = 360;
  const context = source.getContext("2d");
  if (!context) throw new Error("Canvas 2D unavailable.");
  const gradient = context.createLinearGradient(0, 0, 640, 360);
  gradient.addColorStop(0, "#7ce8ff");
  gradient.addColorStop(.45, "#6848ff");
  gradient.addColorStop(1, "#ff755a");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 640, 360);
  context.fillStyle = "#ffffff";
  context.font = "900 74px Arial";
  context.fillText("GPU", 220, 205);

  const params = (frame: number): Plane3DParams => ({
    rotation: [-0.12, -0.42 + frame / 90, 0.04],
    position: [0, 0, 0],
    scale: [0.92, 0.92, 1],
    dof: { focus: 2.6, aperture: 0.018, maxBlur: 0.018 },
    grade: { exposure: 0.05, contrast: 0.12, saturation: 1.08, temperature: 0.08, tint: 0, highlights: 0, shadows: 0, vignette: 0.12, bloom: 0.12, bloomThreshold: 0.7 },
  });

  await renderer.render(source, params(0));
  const stopFrame = onFrame((state) => renderer.render(source, params(state.frame)));
  const stopCapture = registerCanvasCapture(canvas, (time) => renderer.capture(source, params(time * 30)));
  onCleanup(() => {
    stopFrame();
    stopCapture();
    renderer.destroy();
  });
};

const child = defineComposition(childSource);
const dom = defineComposition(domSource);
const nested = defineComposition(nestedSource);
const media = defineComposition(mediaSource);
const gpu = defineComposition(gpuSource, { setup: gpuSetup });
const cloth = defineComposition(clothSource, {
  setup: combineCompositionSetups(createClothSetup({
    simulation: { gravity: [0, -2.4, 0], wind: (time) => [1.2 + Math.sin(time * 2), 0.1, 0.35] },
    clearColor: "#0a0c0b",
  })),
});

const registry: CompositionRegistry = { child, dom, nested, media, gpu, cloth };

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function canvasBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG encoding failed.")), "image/png"),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

async function captureCase(name: string, composition: CompositionConfig, frame: number): Promise<CapabilityResult> {
  const started = performance.now();
  const first = await captureCompositeFrame(composition, frame, {
    width: composition.width,
    height: composition.height,
    registry,
  });
  const second = await captureCompositeFrame(composition, frame, {
    width: composition.width,
    height: composition.height,
    registry,
  });
  const firstBytes = await canvasBytes(first);
  const secondBytes = await canvasBytes(second);
  const firstHash = await sha256(firstBytes);
  const secondHash = await sha256(secondBytes);
  artifacts.set(`${name}.png`, { contentType: "image/png", bytes: firstBytes });
  if (firstHash !== secondHash) throw new Error(`${name} capture was not deterministic.`);
  return {
    name,
    durationMs: Math.round(performance.now() - started),
    deterministic: true,
    hash: firstHash,
    bytes: firstBytes.byteLength,
  };
}

async function exportCase(name: string, composition: CompositionConfig, frames: number): Promise<CapabilityResult> {
  const started = performance.now();
  const output = new Uint8Array(await exportVideo(composition, {
    width: composition.width,
    height: composition.height,
    codec: "avc1.42001f",
    muxerCodec: "avc",
    bitrate: 2_500_000,
    hardwareAcceleration: "prefer-hardware",
    startFrame: 0,
    endFrame: frames,
    registry,
  }));
  if (output.byteLength < 1024) throw new Error(`${name} MP4 output was unexpectedly small.`);
  artifacts.set(`${name}.mp4`, { contentType: "video/mp4", bytes: output });
  return {
    name,
    durationMs: Math.round(performance.now() - started),
    hash: await sha256(output),
    bytes: output.byteLength,
    detail: { frames },
  };
}

async function browserCapabilities() {
  const gpuApi = "gpu" in navigator;
  const adapter = gpuApi ? await navigator.gpu.requestAdapter({ powerPreference: "high-performance" }) : null;
  const adapterInfo = adapter?.info ? {
    vendor: adapter.info.vendor,
    architecture: adapter.info.architecture,
    device: adapter.info.device,
    description: adapter.info.description,
  } : null;
  const h264 = typeof VideoEncoder !== "undefined"
    ? await VideoEncoder.isConfigSupported({ codec: "avc1.42001f", width: 640, height: 360, bitrate: 2_500_000, framerate: 30, hardwareAcceleration: "prefer-hardware" })
    : null;
  return {
    userAgent: navigator.userAgent,
    gpuApi,
    adapterInfo,
    h264Supported: h264?.supported ?? false,
    audioEncoder: typeof AudioEncoder !== "undefined",
    videoDecoder: typeof VideoDecoder !== "undefined",
  };
}

async function runSuite() {
  const startedAt = new Date().toISOString();
  const browser = await browserCapabilities();
  if (!browser.gpuApi || !browser.adapterInfo) throw new Error("Hardware WebGPU is unavailable.");
  const adapterText = JSON.stringify(browser.adapterInfo).toLowerCase();
  if (adapterText.includes("swiftshader") || adapterText.includes("software")) {
    throw new Error(`Software WebGPU fallback detected: ${JSON.stringify(browser.adapterInfo)}`);
  }
  if (!browser.h264Supported) throw new Error("Chrome does not expose H.264 VideoEncoder support.");
  if (!browser.videoDecoder) throw new Error("Chrome does not expose VideoDecoder.");

  const results: CapabilityResult[] = [];
  results.push(await captureCase("dom-css-svg", dom, 12));
  results.push(await captureCase("nested-composition", nested, 11));
  results.push(await captureCase("exact-video-frame", media, 18));
  results.push(await captureCase("webgpu-scene", gpu, 14));
  results.push(await captureCase("webgpu-cloth", cloth, 16));
  results.push(await exportCase("video-audio-export", media, 18));
  results.push(await exportCase("webgpu-export", gpu, 10));

  return {
    version: 1,
    startedAt,
    finishedAt: new Date().toISOString(),
    browser,
    results,
    artifactNames: Array.from(artifacts.keys()),
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

declare global {
  interface Window {
    __runFrameDiffCloudSuite: typeof runSuite;
    __readFrameDiffCloudArtifact: (name: string) => { contentType: string; base64: string };
  }
}

window.__runFrameDiffCloudSuite = runSuite;
window.__readFrameDiffCloudArtifact = (name) => {
  const artifact = artifacts.get(name);
  if (!artifact) throw new Error(`Unknown cloud harness artifact: ${name}`);
  return { contentType: artifact.contentType, base64: bytesToBase64(artifact.bytes) };
};
document.querySelector("#status")!.textContent = "ready";
