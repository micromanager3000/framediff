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

type InferenceKind = "depth-map" | "segmentation" | "background-removal";

const DEPTH_MODEL = {
  id: "onnx-community/depth-anything-v2-small",
  revision: "4472b7362082ad9968fee890ca0f1e5aca36b93d",
};
const SEGMENTATION_MODEL = {
  id: "Xenova/segformer-b0-finetuned-ade-512-512",
  revision: "d3e5499fa8701ff0453ca940a8dfeae39b2f1504",
};
const RVM_MODEL = {
  id: "PeterL1n/RobustVideoMatting",
  revision: "v1.0.0",
  file: "rvm_mobilenetv3_fp32.onnx",
  sha256: "88d4531297118f595bf2fd60f6f566aec2e559393802d1f436c380f0cbbd2828",
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

function assertHardwareWebGpu(browser: Awaited<ReturnType<typeof browserCapabilities>>) {
  if (!browser.gpuApi || !browser.adapterInfo) throw new Error("Hardware WebGPU is unavailable.");
  const adapterText = JSON.stringify(browser.adapterInfo).toLowerCase();
  if (adapterText.includes("swiftshader") || adapterText.includes("software")) {
    throw new Error(`Software WebGPU fallback detected: ${JSON.stringify(browser.adapterInfo)}`);
  }
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

async function blobDataUrl(blob: Blob): Promise<string> {
  const bytes = await blobBytes(blob);
  return `data:${blob.type || "application/octet-stream"};base64,${bytesToBase64(bytes)}`;
}

async function defaultInferenceInput(): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 384;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable for the inference fixture.");

  const sky = context.createLinearGradient(0, 0, 0, 384);
  sky.addColorStop(0, "#79c9ff");
  sky.addColorStop(0.58, "#dff3ff");
  sky.addColorStop(1, "#e8c798");
  context.fillStyle = sky;
  context.fillRect(0, 0, 640, 384);

  context.fillStyle = "#70816f";
  context.fillRect(0, 218, 640, 166);
  context.fillStyle = "#32353b";
  context.beginPath();
  context.moveTo(242, 384);
  context.lineTo(330, 218);
  context.lineTo(408, 218);
  context.lineTo(570, 384);
  context.fill();
  context.strokeStyle = "#f5e89a";
  context.lineWidth = 6;
  context.setLineDash([24, 20]);
  context.beginPath();
  context.moveTo(395, 384);
  context.lineTo(367, 230);
  context.stroke();
  context.setLineDash([]);

  context.fillStyle = "#f0ddc4";
  context.fillRect(66, 120, 218, 134);
  context.fillStyle = "#9e4d3d";
  context.beginPath();
  context.moveTo(42, 126);
  context.lineTo(175, 48);
  context.lineTo(306, 126);
  context.closePath();
  context.fill();
  context.fillStyle = "#704532";
  context.fillRect(150, 184, 48, 70);
  context.fillStyle = "#72bfea";
  context.fillRect(88, 150, 48, 42);
  context.fillRect(218, 150, 42, 42);

  context.fillStyle = "#3c7139";
  for (const [x, y, radius] of [[500, 132, 62], [545, 168, 52], [470, 184, 50]] as const) {
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
  context.fillStyle = "#69432b";
  context.fillRect(500, 184, 25, 78);

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Inference fixture encoding failed.")), "image/png"),
  );
  return blobDataUrl(blob);
}

async function normalizeInferenceInput(inputDataUrl?: string): Promise<string> {
  const source = inputDataUrl || await defaultInferenceInput();
  const image = new Image();
  image.src = source;
  await image.decode();
  if (image.naturalWidth > 4096 || image.naturalHeight > 4096) {
    throw new Error(`Inference input is too large: ${image.naturalWidth}×${image.naturalHeight}; maximum is 4096×4096.`);
  }
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable for inference input normalization.");
  context.drawImage(image, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Inference input encoding failed.")), "image/png"),
  );
  const bytes = await blobBytes(blob);
  artifacts.set("input.png", { contentType: "image/png", bytes });
  return blobDataUrl(blob);
}

async function imageCanvas(source: string): Promise<HTMLCanvasElement> {
  const image = new Image();
  image.src = source;
  await image.decode();
  const scale = Math.min(1, 1280 / image.naturalWidth, 720 / image.naturalHeight);
  const width = Math.max(32, Math.floor((image.naturalWidth * scale) / 32) * 32);
  const height = Math.max(32, Math.floor((image.naturalHeight * scale) / 32) * 32);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas 2D is unavailable for RVM input.");
  context.drawImage(image, 0, 0, width, height);
  return canvas;
}

async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG encoding failed.")), "image/png"),
  );
  return blobBytes(blob);
}

async function runRvm(source: string) {
  const ort = await import("onnxruntime-web/webgpu");
  ort.env.logLevel = "error";
  ort.env.wasm.wasmPaths = "/ort/";
  const canvas = await imageCanvas(source);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas 2D is unavailable for RVM input.");
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const plane = canvas.width * canvas.height;
  const sourceTensor = new Float32Array(plane * 3);
  for (let index = 0; index < plane; index += 1) {
    sourceTensor[index] = pixels[index * 4]! / 255;
    sourceTensor[plane + index] = pixels[index * 4 + 1]! / 255;
    sourceTensor[plane * 2 + index] = pixels[index * 4 + 2]! / 255;
  }
  const session = await ort.InferenceSession.create(
    `/models/${RVM_MODEL.id}/${RVM_MODEL.file}`,
    { executionProviders: ["webgpu"] },
  );
  const recurrent = () => new ort.Tensor("float32", new Float32Array([0]), [1, 1, 1, 1]);
  try {
    const output = await session.run({
      src: new ort.Tensor("float32", sourceTensor, [1, 3, canvas.height, canvas.width]),
      r1i: recurrent(),
      r2i: recurrent(),
      r3i: recurrent(),
      r4i: recurrent(),
      downsample_ratio: new ort.Tensor("float32", new Float32Array([0.25]), [1]),
    });
    const foreground = output.fgr?.data as Float32Array | undefined;
    const alpha = output.pha?.data as Float32Array | undefined;
    if (!foreground || !alpha || foreground.length !== plane * 3 || alpha.length !== plane) {
      throw new Error("RVM returned an unexpected foreground or matte shape.");
    }
    const foregroundCanvas = document.createElement("canvas");
    const matteCanvas = document.createElement("canvas");
    foregroundCanvas.width = matteCanvas.width = canvas.width;
    foregroundCanvas.height = matteCanvas.height = canvas.height;
    const foregroundContext = foregroundCanvas.getContext("2d");
    const matteContext = matteCanvas.getContext("2d");
    if (!foregroundContext || !matteContext) throw new Error("Canvas 2D is unavailable for RVM output.");
    const foregroundImage = foregroundContext.createImageData(canvas.width, canvas.height);
    const matteImage = matteContext.createImageData(canvas.width, canvas.height);
    let alphaSum = 0;
    for (let index = 0; index < plane; index += 1) {
      const matte = Math.max(0, Math.min(1, Number(alpha[index])));
      const matteByte = Math.round(matte * 255);
      alphaSum += matte;
      foregroundImage.data[index * 4] = Math.round(Math.max(0, Math.min(1, Number(foreground[index]))) * 255);
      foregroundImage.data[index * 4 + 1] = Math.round(Math.max(0, Math.min(1, Number(foreground[plane + index]))) * 255);
      foregroundImage.data[index * 4 + 2] = Math.round(Math.max(0, Math.min(1, Number(foreground[plane * 2 + index]))) * 255);
      foregroundImage.data[index * 4 + 3] = matteByte;
      matteImage.data[index * 4] = matteByte;
      matteImage.data[index * 4 + 1] = matteByte;
      matteImage.data[index * 4 + 2] = matteByte;
      matteImage.data[index * 4 + 3] = 255;
    }
    foregroundContext.putImageData(foregroundImage, 0, 0);
    matteContext.putImageData(matteImage, 0, 0);
    artifacts.set("foreground.png", { contentType: "image/png", bytes: await canvasPng(foregroundCanvas) });
    artifacts.set("matte.png", { contentType: "image/png", bytes: await canvasPng(matteCanvas) });
    return {
      width: canvas.width,
      height: canvas.height,
      alphaMean: alphaSum / plane,
      channels: ["foreground", "matte"],
    };
  } finally {
    await session.release();
  }
}

function colorForIndex(index: number): [number, number, number] {
  const palette: Array<[number, number, number]> = [
    [46, 196, 182], [255, 107, 107], [255, 209, 102], [76, 201, 240],
    [155, 93, 229], [87, 204, 153], [244, 162, 97], [72, 149, 239],
    [247, 37, 133], [181, 228, 140], [255, 159, 28], [0, 187, 249],
  ];
  return palette[index % palette.length]!;
}

async function runInference(kind: InferenceKind, inputDataUrl?: string) {
  artifacts.clear();
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const browser = await browserCapabilities();
  assertHardwareWebGpu(browser);
  const source = await normalizeInferenceInput(inputDataUrl);
  if (kind === "background-removal") {
    const result = await runRvm(source);
    return {
      version: 1,
      kind,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - started),
      browser,
      model: RVM_MODEL,
      result,
      artifactNames: Array.from(artifacts.keys()),
    };
  }
  const { env, pipeline } = await import("@huggingface/transformers");
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = "/models/";

  if (kind === "depth-map") {
    const estimator = await pipeline("depth-estimation", DEPTH_MODEL.id, {
      device: "webgpu",
      dtype: "fp32",
      revision: DEPTH_MODEL.revision,
    }) as any;
    try {
      const output = await estimator(source);
      const depthBlob = await output.depth.toBlob("image/png");
      const depthBytes = await blobBytes(depthBlob);
      artifacts.set("depth-map.png", { contentType: "image/png", bytes: depthBytes });
      const raw = output.predicted_depth;
      return {
        version: 1,
        kind,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Math.round(performance.now() - started),
        browser,
        model: DEPTH_MODEL,
        result: {
          width: output.depth.width,
          height: output.depth.height,
          rawDepthMin: Number(raw.min().item()),
          rawDepthMax: Number(raw.max().item()),
        },
        artifactNames: Array.from(artifacts.keys()),
      };
    } finally {
      await estimator.dispose();
    }
  }

  const segmenter = await pipeline("image-segmentation", SEGMENTATION_MODEL.id, {
    device: "webgpu",
    dtype: "fp32",
    revision: SEGMENTATION_MODEL.revision,
  }) as any;
  try {
    const segments = await segmenter(source);
    if (!segments.length) throw new Error("The segmentation model returned no masks.");
    const width = segments[0].mask.width;
    const height = segments[0].mask.height;
    const visualization = document.createElement("canvas");
    visualization.width = width;
    visualization.height = height;
    const context = visualization.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable for segmentation visualization.");
    const imageData = context.createImageData(width, height);
    const labels = segments.map((segment: any, index: number) => {
      const [red, green, blue] = colorForIndex(index);
      let pixels = 0;
      for (let offset = 0; offset < segment.mask.data.length; offset += 1) {
        if (segment.mask.data[offset] === 0) continue;
        pixels += 1;
        const target = offset * 4;
        imageData.data[target] = red;
        imageData.data[target + 1] = green;
        imageData.data[target + 2] = blue;
        imageData.data[target + 3] = 255;
      }
      return { label: segment.label, score: segment.score, pixels, color: [red, green, blue] };
    });
    context.putImageData(imageData, 0, 0);
    const visualizationBlob = await new Promise<Blob>((resolve, reject) =>
      visualization.toBlob((value) => value ? resolve(value) : reject(new Error("Segmentation encoding failed.")), "image/png"),
    );
    artifacts.set("segmentation.png", { contentType: "image/png", bytes: await blobBytes(visualizationBlob) });
    artifacts.set("labels.json", {
      contentType: "application/json",
      bytes: new TextEncoder().encode(JSON.stringify(labels, null, 2)),
    });
    return {
      version: 1,
      kind,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - started),
      browser,
      model: SEGMENTATION_MODEL,
      result: { width, height, segmentCount: labels.length, labels },
      artifactNames: Array.from(artifacts.keys()),
    };
  } finally {
    await segmenter.dispose();
  }
}

async function runSuite() {
  artifacts.clear();
  const startedAt = new Date().toISOString();
  const browser = await browserCapabilities();
  assertHardwareWebGpu(browser);
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
    __runFrameDiffInference: typeof runInference;
    __readFrameDiffCloudArtifact: (name: string) => { contentType: string; base64: string };
  }
}

window.__runFrameDiffCloudSuite = runSuite;
window.__runFrameDiffInference = runInference;
window.__readFrameDiffCloudArtifact = (name) => {
  const artifact = artifacts.get(name);
  if (!artifact) throw new Error(`Unknown cloud harness artifact: ${name}`);
  return { contentType: artifact.contentType, base64: bytesToBase64(artifact.bytes) };
};
document.querySelector("#status")!.textContent = "ready";
