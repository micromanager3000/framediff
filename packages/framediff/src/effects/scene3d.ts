/// <reference types="@webgpu/types" />
// A real 3D video plane: a textured quad through a perspective camera, with SCREEN-SPACE
// depth-of-field and the same grade/LUT/bloom/vignette as GradedVideo — so a tilted interface
// shot matches the rest of the reel.
//
// Two passes, the way a camera (and AE's camera + lens blur) actually works:
//   A. the plane renders sharp into offscreen color+view-depth targets
//   B. a fullscreen pass computes each pixel's circle of confusion from the depth map and
//      gathers a premultiplied disc — blur lives in SCREEN pixels, so out-of-focus regions
//      keep their blur regardless of where they land on the plane, and defocused silhouette
//      edges bloom outward past the quad instead of clipping at it. Grade/LUT/bloom/vignette
//      run on the resolved image in the same pass.
// Renders to a transparent canvas; same upload + copyTextureToBuffer readback as the grade
// pass → the exporter bakes the exact frame via the data-framediff-webgpu seam.

import { perspective, lookAt, chain, translate, scale, rotateX, rotateY, rotateZ, type M4, type V3 } from "./mat4";
import { lutToRGBA8, type LUT3D } from "./lut";
import type { GradeParams } from "./grade";

export interface DofParams {
  focus: number;
  aperture: number;
  maxBlur?: number;
  /** Circle-of-confusion model: "linear" (legacy) blurs by |depth − focus| · aperture;
   *  "thinLens" blurs by aperture · |1/focus − 1/depth| — the falloff a real lens (and AE's
   *  camera) produces. With thinLens, aperture is in true pixels of CoC per unit of
   *  (1/focus − 1/depth): AE's aperture·(blurLevel/100)·zoom/compHeight converts exactly. */
  model?: "linear" | "thinLens";
}

export interface Plane3DParams {
  position?: V3;
  rotation?: V3; // radians, X→Y→Z
  scale?: V3;
  /** plane width/height in world units; defaults to the legacy 16:9 quad (1.6 × 0.9) */
  planeSize?: [number, number];
  fov?: number; // degrees
  eye?: V3;
  target?: V3;
  dof?: DofParams;
  /** the same color grade as GradedVideo, applied to the plane's texels. */
  grade?: GradeParams;
  /** Extra camera poses inside the shutter interval (motion blur, AE-style): the plane is
   *  drawn once per pose and averaged with the main draw. Only the transform fields are read;
   *  DoF/grade/depth stay on the main (shutter-center) pose. Capped at 15. */
  shutterPoses?: Plane3DParams[];
}

export type SceneSource = ImageBitmap | HTMLCanvasElement | OffscreenCanvas | HTMLVideoElement | VideoFrame;

export interface Scene3DRenderer {
  render(source: SceneSource, params: Plane3DParams): Promise<void>;
  capture(source: SceneSource, params: Plane3DParams): Promise<HTMLCanvasElement>;
  setLUT(lut: LUT3D | null): void;
  destroy(): void;
}

// prettier-ignore
const QUAD = new Float32Array([
  -0.8,  0.45, 0,  0, 0,
   0.8,  0.45, 0,  1, 0,
   0.8, -0.45, 0,  1, 1,
  -0.8,  0.45, 0,  0, 0,
   0.8, -0.45, 0,  1, 1,
  -0.8, -0.45, 0,  0, 1,
]);

// Gather disc (golden-angle spiral) — radii jittered by tap index, no per-frame noise.
// Sized for the AE-imported CoC radii: at the uizoom whip's ~50px cap, 25 taps left visible
// spiral grit on blurred UI text; 64 keeps the disc dense enough to read as a lens blur.
const TAPS = 64;

const wgsl = (w: number, h: number) => /* wgsl */ `
const RES = vec2<f32>(${w.toFixed(1)}, ${h.toFixed(1)});
const TAPS = ${TAPS};
struct U { mvp: mat4x4<f32>, dof: vec4<f32>, wb: vec4<f32>, tone: vec4<f32>, extra: vec4<f32> };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;
@group(0) @binding(3) var lut: texture_3d<f32>;
@group(0) @binding(4) var colorTex: texture_2d<f32>;
@group(0) @binding(5) var depthTex: texture_2d<f32>;

struct VOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32>, @location(1) depth: f32 };

// ---- pass A: the plane, sharp, into color + view-depth targets ----

@vertex
fn vsPlane(@location(0) position: vec3<f32>, @location(1) uv: vec2<f32>) -> VOut {
  let clip = u.mvp * vec4<f32>(position, 1.0);
  var o: VOut;
  o.pos = clip;
  o.uv = uv;
  o.depth = clip.w;
  return o;
}

struct PlaneOut { @location(0) color: vec4<f32>, @location(1) depth: vec4<f32> };

@fragment
fn fsPlane(in: VOut) -> PlaneOut {
  // u.extra.w = this draw's shutter-sample weight (1 with motion blur off). Color and alpha
  // are premultiplied by it so additive accumulation over the shutter integrates to 1.
  let w = u.extra.w;
  var o: PlaneOut;
  o.color = vec4<f32>(textureSampleLevel(tex, samp, in.uv, 0.0).rgb * w, w);
  o.depth = vec4<f32>(in.depth, 0.0, 0.0, 1.0);
  return o;
}

// ---- pass B: screen-space DoF resolve + grade ----

struct FOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };

@vertex
fn vsFull(@builtin(vertex_index) i: u32) -> FOut {
  // fullscreen triangle
  let xy = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  var o: FOut;
  o.pos = vec4<f32>(xy * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2<f32>(xy.x, 1.0 - xy.y);
  return o;
}

fn luma(c: vec3<f32>) -> f32 { return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722)); }

/** CoC radius in SCREEN PIXELS for a view depth. Zero-coverage (background) depths return 0. */
fn cocPx(d: f32, coverage: f32) -> f32 {
  if (coverage < 0.004 || d < 1e-4) { return 0.0; }
  let focus = u.dof.x; let aperture = u.dof.y; let maxBlur = u.dof.z; let thinLens = u.dof.w;
  var cocUv = abs(d - focus) * aperture; // legacy: radius in uv-height units
  if (thinLens > 0.5) {
    // aperture already converted to px per unit of (1/f − 1/d). Two corrections measured
    // against the AE reference: the calibrated value is a CoC DIAMETER (radius-interpretation
    // doubles every blur), and AE's iris kernel is effectively identity below ~1.5px radius —
    // without the deadband, near-focus regions AE renders pin-sharp pick up a visible soften
    // (and the settle of a rack, whose CoCs live entirely in that regime, never re-sharpens).
    let r = 0.5 * aperture * abs(1.0 / max(focus, 0.05) - 1.0 / max(d, 0.05)) - 1.5;
    return clamp(r, 0.0, maxBlur * RES.y);
  }
  return clamp(cocUv, 0.0, maxBlur) * RES.y;
}

@fragment
fn fsPost(in: FOut) -> @location(0) vec4<f32> {
  let temperature = u.wb.x; let tint = u.wb.y; let exposure = u.wb.z; let contrast = u.wb.w;
  let highlights = u.tone.x; let shadows = u.tone.y; let saturation = u.tone.z; let vignette = u.tone.w;
  let lutIntensity = u.extra.x; let bloom = u.extra.y; let bloomT = u.extra.z;

  let px = in.uv * RES;
  let c0 = textureSampleLevel(colorTex, samp, in.uv, 0.0);
  let d0 = textureSampleLevel(depthTex, samp, in.uv, 0.0).r;
  let centerCoc = cocPx(d0, c0.a);
  let maxRad = u.dof.z * RES.y;

  // Adapt the gather disc to the local CoC: with a fixed maxRad disc, a pixel whose blur is
  // small relative to the cap lands only 1-2 discrete taps inside its CoC and mildly-blurred
  // text renders as ghost echoes instead of a smooth disc. CoC varies smoothly across a plane
  // (uizoom's steepest fit gradient ≈0.03 px/px), so 2× the center CoC covers every tap that
  // can contribute; pixels OFF the plane keep the full radius to collect defocused silhouette
  // bleed (their own CoC is 0, the content's isn't).
  var gatherRad = maxRad;
  if (c0.a >= 0.004) { gatherRad = clamp(max(centerCoc * 2.0, 2.0), 2.0, maxRad); }
  // The contribution feather must scale with the tap spacing: a fixed 1px feather over-collects
  // when the adapted disc is small (every tap sits inside 1px → sharp pixels box-blur) and
  // under-collects echoes when the disc is large.
  let feather = max(gatherRad / sqrt(f32(TAPS)), 0.75);

  // scatter-as-gather: a tap contributes where its own CoC (or the center's, for background
  // taps) reaches this pixel — blurred content bleeds outward, sharp content stays put.
  var accC = vec3<f32>(0.0);
  var accA = 0.0;
  var wsum = 0.0;
  for (var k = 0; k < TAPS; k = k + 1) {
    let fk = f32(k);
    let r = gatherRad * sqrt((fk + 0.5) / f32(TAPS));
    let a = fk * 2.3999632; // golden angle
    let offs = vec2<f32>(cos(a), sin(a)) * r;
    let tuv = clamp((px + offs) / RES, vec2<f32>(0.0), vec2<f32>(1.0));
    let tc = textureSampleLevel(colorTex, samp, tuv, 0.0);
    let td = textureSampleLevel(depthTex, samp, tuv, 0.0).r;
    let tCoc = max(cocPx(td, tc.a), centerCoc * step(tc.a, 0.004));
    let dist = length(offs);
    // contributes where the tap's own CoC reaches this pixel; 0.5 centers the feather on the rim
    let w = clamp((tCoc - dist) / feather + 0.5, 0.0, 1.0);
    accC = accC + tc.rgb * tc.a * w;
    accA = accA + tc.a * w;
    wsum = wsum + w;
  }
  // the center tap always contributes fully
  accC = accC + c0.rgb * c0.a;
  accA = accA + c0.a;
  wsum = wsum + 1.0;

  let alpha = accA / max(wsum, 1e-4);
  if (alpha < 0.002) { return vec4<f32>(0.0); }
  var c = accC / max(accA, 1e-4); // un-premultiplied resolved color

  // grade (same as GradedVideo)
  c = c * pow(2.0, exposure);
  c.r = c.r * (1.0 + temperature * 0.12 + tint * 0.06);
  c.g = c.g * (1.0 - tint * 0.10);
  c.b = c.b * (1.0 - temperature * 0.12 + tint * 0.06);
  let L = luma(c);
  c = c + shadows * 0.5 * smoothstep(0.5, 0.0, L);
  c = c + highlights * 0.5 * smoothstep(0.5, 1.0, L);
  c = (c - vec3<f32>(0.5)) * (1.0 + contrast) + vec3<f32>(0.5);
  c = mix(vec3<f32>(luma(c)), c, saturation);

  if (lutIntensity > 0.0) {
    let cc = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
    c = mix(c, textureSampleLevel(lut, samp, cc, 0.0).rgb, lutIntensity);
  }
  if (bloom > 0.0) {
    var bl = vec3<f32>(0.0);
    for (var k = 0; k < 16; k = k + 1) {
      let aa = f32(k) / 16.0 * 6.2831853;
      let rr = 0.012 * (0.5 + 0.5 * fract(f32(k) * 0.61803));
      let sm = textureSampleLevel(colorTex, samp, clamp(in.uv + vec2<f32>(cos(aa), sin(aa)) * rr, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
      bl = bl + max(vec3<f32>(0.0), sm.rgb * sm.a - vec3<f32>(bloomT));
    }
    c = c + (bl / 16.0) * bloom * 3.0;
  }

  // full-frame vignette (screen position)
  c = c * (1.0 - vignette * smoothstep(0.3, 0.78, distance(in.uv, vec2<f32>(0.5))));

  let cl = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(cl * alpha, alpha); // premultiplied out
}
`;

function sourceSize(s: SceneSource): [number, number] {
  if (s instanceof HTMLVideoElement) return [s.videoWidth || 2, s.videoHeight || 2];
  if (typeof VideoFrame !== "undefined" && s instanceof VideoFrame) return [s.displayWidth, s.displayHeight];
  return [(s as HTMLCanvasElement).width || 2, (s as HTMLCanvasElement).height || 2];
}

function mvpOf(p: Plane3DParams, aspect: number): M4 {
  const pos = p.position ?? [0, 0, 0];
  const rot = p.rotation ?? [0, 0, 0];
  const scl = p.scale ?? [1, 1, 1];
  // the quad geometry is 1.6 × 0.9; planeSize rescales it to the requested world size
  const sizeX = (p.planeSize?.[0] ?? 1.6) / 1.6;
  const sizeY = (p.planeSize?.[1] ?? 0.9) / 0.9;
  const model = chain(translate(pos[0], pos[1], pos[2]), rotateY(rot[1]), rotateX(rot[0]), rotateZ(rot[2]), scale(scl[0] * sizeX, scl[1] * sizeY, scl[2]));
  const view = lookAt(p.eye ?? [0, 0, 2.6], p.target ?? [0, 0, 0], [0, 1, 0]);
  const proj = perspective(((p.fov ?? 45) * Math.PI) / 180, aspect, 0.1, 100);
  return chain(proj, view, model);
}

const IDENTITY_LUT: LUT3D = (() => {
  const data = new Float32Array(24);
  let i = 0;
  for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) { data[i++] = r; data[i++] = g; data[i++] = b; }
  return { size: 2, data };
})();

export async function createScene3DRenderer(canvas: HTMLCanvasElement, width: number, height: number): Promise<Scene3DRenderer | null> {
  if (!("gpu" in navigator)) return null;
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const ctx = canvas.getContext("webgpu");
  if (!ctx) return null;
  canvas.width = width;
  canvas.height = height;
  const aspect = width / height;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: "premultiplied", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });

  const vbuf = device.createBuffer({ size: QUAD.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(vbuf, 0, QUAD);
  const uni = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });

  const module = device.createShaderModule({ code: wgsl(width, height) });
  const planeVertexState = {
    module,
    entryPoint: "vsPlane",
    buffers: [{ arrayStride: 20, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }, { shaderLocation: 1, offset: 12, format: "float32x2" }] }],
  } as const;
  const planePipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: planeVertexState,
    fragment: { module, entryPoint: "fsPlane", targets: [{ format: "rgba16float" }, { format: "r16float" }] },
    primitive: { topology: "triangle-list", cullMode: "none" },
  });
  // shutter-sample accumulation: additive color, no depth writes (depth comes from the
  // shutter-center draw so the DoF resolve sees one coherent depth field, not an average)
  const addBlend = { color: { srcFactor: "one", dstFactor: "one" }, alpha: { srcFactor: "one", dstFactor: "one" } } as const;
  const accumPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: planeVertexState,
    fragment: {
      module,
      entryPoint: "fsPlane",
      targets: [
        { format: "rgba16float", blend: addBlend },
        { format: "r16float", writeMask: 0 },
      ],
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
  });
  const postPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vsFull" },
    fragment: { module, entryPoint: "fsPost", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });

  // offscreen targets for pass A
  const colorTex = device.createTexture({ size: [width, height], format: "rgba16float", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
  const depthTex = device.createTexture({ size: [width, height], format: "r16float", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });

  let tex: GPUTexture | null = null;
  let texW = 0;
  let texH = 0;
  let lutTex: GPUTexture;
  let planeBind: GPUBindGroup | null = null;
  let postBind: GPUBindGroup | null = null;

  const makeLUTTex = (lut: LUT3D) => {
    lutTex?.destroy();
    lutTex = device.createTexture({ size: [lut.size, lut.size, lut.size], dimension: "3d", format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: lutTex }, lutToRGBA8(lut), { bytesPerRow: lut.size * 4, rowsPerImage: lut.size }, [lut.size, lut.size, lut.size]);
  };
  makeLUTTex(IDENTITY_LUT);

  // one uniform buffer + bind group per shutter sample (queue.writeBuffer lands at submit,
  // so per-draw values inside one submission need distinct buffers)
  const MAX_SHUTTER_SAMPLES = 15;
  const sampleUnis: GPUBuffer[] = [];
  const sampleBinds: GPUBindGroup[] = [];
  const sampleBind = (i: number): GPUBindGroup => {
    while (sampleUnis.length <= i) {
      sampleUnis.push(device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    }
    while (sampleBinds.length <= i) {
      sampleBinds.push(
        device.createBindGroup({
          layout: accumPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: sampleUnis[sampleBinds.length] } },
            { binding: 1, resource: sampler },
            { binding: 2, resource: tex!.createView() },
          ],
        }),
      );
    }
    return sampleBinds[i];
  };

  const recreateBindGroups = () => {
    if (!tex) return;
    planeBind = device.createBindGroup({
      layout: planePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uni } },
        { binding: 1, resource: sampler },
        { binding: 2, resource: tex.createView() },
      ],
    });
    postBind = device.createBindGroup({
      layout: postPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uni } },
        { binding: 1, resource: sampler },
        { binding: 3, resource: lutTex.createView({ dimension: "3d" }) },
        { binding: 4, resource: colorTex.createView() },
        { binding: 5, resource: depthTex.createView() },
      ],
    });
    sampleBinds.length = 0; // rebuilt lazily against the new texture
  };

  const ensureTex = (w: number, h: number) => {
    if (tex && texW === w && texH === h) return;
    tex?.destroy();
    tex = device.createTexture({ size: [w, h], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    texW = w;
    texH = h;
    recreateBindGroups();
  };

  const upload = (source: SceneSource) => {
    const [w, h] = sourceSize(source);
    ensureTex(w, h);
    device.queue.copyExternalImageToTexture({ source: source as GPUCopyExternalImageSource, flipY: false }, { texture: tex! }, [w, h]);
  };

  const drawTo = (view: GPUTextureView, encoder: GPUCommandEncoder, params: Plane3DParams) => {
    const shutter = (params.shutterPoses ?? []).slice(0, MAX_SHUTTER_SAMPLES);
    const weight = 1 / (1 + shutter.length);
    const u = new Float32Array(32);
    u.set(mvpOf(params, aspect), 0);
    u[16] = params.dof?.focus ?? 0;
    u[17] = params.dof?.aperture ?? 0;
    u[18] = params.dof?.maxBlur ?? 0.03;
    u[19] = params.dof?.model === "thinLens" ? 1 : 0;
    const g = params.grade ?? {};
    u[20] = g.temperature ?? 0;
    u[21] = g.tint ?? 0;
    u[22] = g.exposure ?? 0;
    u[23] = g.contrast ?? 0;
    u[24] = g.highlights ?? 0;
    u[25] = g.shadows ?? 0;
    u[26] = g.saturation ?? 1;
    u[27] = g.vignette ?? 0;
    u[28] = g.lutIntensity ?? 0;
    u[29] = g.bloom ?? 0;
    u[30] = g.bloomThreshold ?? 0.6;
    u[31] = weight; // this draw's shutter-sample weight
    device.queue.writeBuffer(uni, 0, u);
    shutter.forEach((sp, i) => {
      const su = new Float32Array(32);
      su.set(u);
      su.set(mvpOf({ ...params, ...sp }, aspect), 0);
      sampleBind(i); // ensures the buffer exists before writing
      device.queue.writeBuffer(sampleUnis[i], 0, su);
    });

    // pass A: plane → color + view depth; the shutter-center draw carries depth, the other
    // shutter samples accumulate weighted color only
    const passA = encoder.beginRenderPass({
      colorAttachments: [
        { view: colorTex.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" },
        { view: depthTex.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" },
      ],
    });
    passA.setPipeline(planePipeline);
    passA.setBindGroup(0, planeBind!);
    passA.setVertexBuffer(0, vbuf);
    passA.draw(6);
    if (shutter.length) {
      passA.setPipeline(accumPipeline);
      passA.setVertexBuffer(0, vbuf);
      shutter.forEach((_, i) => {
        passA.setBindGroup(0, sampleBind(i));
        passA.draw(6);
      });
    }
    passA.end();

    // pass B: screen-space DoF resolve + grade → destination
    const passB = encoder.beginRenderPass({
      colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
    });
    passB.setPipeline(postPipeline);
    passB.setBindGroup(0, postBind!);
    passB.draw(3);
    passB.end();
  };

  async function render(source: SceneSource, params: Plane3DParams): Promise<void> {
    upload(source);
    const encoder = device.createCommandEncoder();
    drawTo(ctx!.getCurrentTexture().createView(), encoder, params);
    device.queue.submit([encoder.finish()]);
    await Promise.race([device.queue.onSubmittedWorkDone(), lost]);
  }

  const align = 256;
  const bytesPerRow = Math.ceil((width * 4) / align) * align;
  const readback = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const swap = format === "bgra8unorm";

  // a lost/destroyed device leaves mapAsync pending forever — surface it as a rejection so
  // the exporter fails loudly (or retries with a fresh renderer) instead of hanging
  const lost: Promise<never> = device.lost.then((info) => {
    throw new Error(`WebGPU device lost (${info.reason}): ${info.message}`);
  });
  lost.catch(() => {}); // observed here; consumers race against it when they care

  async function capture(source: SceneSource, params: Plane3DParams): Promise<HTMLCanvasElement> {
    upload(source);
    const encoder = device.createCommandEncoder();
    const t = ctx!.getCurrentTexture();
    drawTo(t.createView(), encoder, params);
    encoder.copyTextureToBuffer({ texture: t }, { buffer: readback, bytesPerRow, rowsPerImage: height }, [width, height, 1]);
    device.queue.submit([encoder.finish()]);
    await Promise.race([device.queue.onSubmittedWorkDone(), lost]);
    await Promise.race([readback.mapAsync(GPUMapMode.READ), lost]);
    const mapped = new Uint8Array(readback.getMappedRange());
    const out = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      const row = y * bytesPerRow;
      for (let x = 0; x < width; x++) {
        const s = row + x * 4;
        const d = (y * width + x) * 4;
        // the swap chain is premultiplied; ImageData wants straight alpha (soft DoF edges)
        const a = mapped[s + 3];
        const un = a > 0 && a < 255 ? 255 / a : 1;
        if (swap) { out[d] = mapped[s + 2] * un; out[d + 1] = mapped[s + 1] * un; out[d + 2] = mapped[s] * un; }
        else { out[d] = mapped[s] * un; out[d + 1] = mapped[s + 1] * un; out[d + 2] = mapped[s + 2] * un; }
        out[d + 3] = a;
      }
    }
    readback.unmap();
    const cnv = document.createElement("canvas");
    cnv.width = width;
    cnv.height = height;
    cnv.getContext("2d")!.putImageData(new ImageData(out, width, height), 0, 0);
    return cnv;
  }

  return {
    render,
    capture,
    setLUT: (lut) => { makeLUTTex(lut ?? IDENTITY_LUT); recreateBindGroups(); },
    destroy: () => { tex?.destroy(); lutTex?.destroy(); colorTex.destroy(); depthTex.destroy(); sampleUnis.forEach((b) => b.destroy()); try { device.destroy(); } catch { /* ignore */ } },
  };
}
