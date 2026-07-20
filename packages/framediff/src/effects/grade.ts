/// <reference types="@webgpu/types" />
// A WebGPU video-effect pass: sample a source frame, optionally corner-pin warp it onto a quad
// (transparent outside), apply a Lumetri-style grade, then a 3D LUT. Pure function of the inputs →
// deterministic. Same device/copyTextureToBuffer readback as webgpuTRex so the exporter bakes the
// exact frame. GradedVideo uses it with no warp; VideoPlane installs a warp via setWarp().

import { lutToRGBA8, type LUT3D } from "./lut";
import type { Mat3 } from "./homography";

export interface GradeParams {
  temperature?: number;
  tint?: number;
  exposure?: number;
  contrast?: number;
  highlights?: number;
  shadows?: number;
  saturation?: number;
  vignette?: number;
  lutIntensity?: number;
  /** soft highlight glow strength (0 = off). */
  bloom?: number;
  /** luma above which the bloom kicks in. Default 0.6. */
  bloomThreshold?: number;
}

export type GradeSource = ImageBitmap | HTMLCanvasElement | OffscreenCanvas | HTMLVideoElement | VideoFrame;

export interface GradeRenderer {
  render(source: GradeSource, params: GradeParams): Promise<void>;
  capture(source: GradeSource, params: GradeParams): Promise<HTMLCanvasElement>;
  setLUT(lut: LUT3D | null): void;
  /** install a corner-pin warp: the inverse homography (screen→source). null clears it. */
  setWarp(hinv: Mat3 | null): void;
  destroy(): void;
}

const WGSL = /* wgsl */ `
struct Grade { wb: vec4<f32>, tone: vec4<f32>, extra: vec4<f32>, h0: vec4<f32>, h1: vec4<f32>, h2: vec4<f32> };
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> g: Grade;
@group(0) @binding(3) var lut: texture_3d<f32>;

struct VOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  let xy = p[vi];
  var o: VOut;
  o.pos = vec4<f32>(xy, 0.0, 1.0);
  o.uv = vec2<f32>((xy.x + 1.0) * 0.5, 1.0 - (xy.y + 1.0) * 0.5);
  return o;
}

fn luma(c: vec3<f32>) -> f32 { return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722)); }

@fragment
fn fs(in: VOut) -> @location(0) vec4<f32> {
  let temperature = g.wb.x; let tint = g.wb.y; let exposure = g.wb.z; let contrast = g.wb.w;
  let highlights = g.tone.x; let shadows = g.tone.y; let saturation = g.tone.z; let vignette = g.tone.w;
  let lutIntensity = g.extra.x; let warpOn = g.extra.y; let bloom = g.extra.z; let bloomT = g.extra.w;

  var uv = in.uv;
  var alpha = 1.0;
  if (warpOn > 0.5) {
    let p = vec3<f32>(in.uv, 1.0);
    let sw = dot(g.h2.xyz, p);
    uv = vec2<f32>(dot(g.h0.xyz, p) / sw, dot(g.h1.xyz, p) / sw);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { alpha = 0.0; }
  }

  var c = textureSampleLevel(tex, samp, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0).rgb;
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

  // soft highlight bloom — blur the bright parts of the source and add (a filmic glow)
  if (bloom > 0.0) {
    var bl = vec3<f32>(0.0);
    for (var k = 0; k < 16; k = k + 1) {
      let aa = f32(k) / 16.0 * 6.2831853;
      let rr = 0.012 * (0.5 + 0.5 * fract(f32(k) * 0.61803));
      let sm = textureSampleLevel(tex, samp, clamp(uv + vec2<f32>(cos(aa), sin(aa)) * rr, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0).rgb;
      bl = bl + max(vec3<f32>(0.0), sm - vec3<f32>(bloomT));
    }
    c = c + (bl / 16.0) * bloom * 3.0;
  }

  let d = distance(in.uv, vec2<f32>(0.5));
  c = c * (1.0 - vignette * smoothstep(0.3, 0.78, d));
  c = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(c * alpha, alpha); // premultiplied
}
`;

function sourceSize(s: GradeSource): [number, number] {
  if (s instanceof HTMLVideoElement) return [s.videoWidth || 2, s.videoHeight || 2];
  if (typeof VideoFrame !== "undefined" && s instanceof VideoFrame) return [s.displayWidth, s.displayHeight];
  return [(s as HTMLCanvasElement).width || 2, (s as HTMLCanvasElement).height || 2];
}

const IDENTITY_LUT: LUT3D = (() => {
  const data = new Float32Array(24);
  let i = 0;
  for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) { data[i++] = r; data[i++] = g; data[i++] = b; }
  return { size: 2, data };
})();

export interface GradeRendererOptions {
  /** Size the output canvas to each source frame's resolution instead of the fixed width/height.
   *  Keeps full source detail through the grade so compositing does the ONE final resample
   *  (like AE). Must stay off when a corner-pin warp is installed — the warp maps screen space,
   *  so the canvas has to be the composition rect, not the source. */
  fitSource?: boolean;
}

export async function createGradeRenderer(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  opts: GradeRendererOptions = {},
): Promise<GradeRenderer | null> {
  if (!("gpu" in navigator)) return null;
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const ctx = canvas.getContext("webgpu");
  if (!ctx) return null;
  canvas.width = width;
  canvas.height = height;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: "premultiplied", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });

  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
  const uni = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const module = device.createShaderModule({ code: WGSL });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });

  let tex: GPUTexture | null = null;
  let texW = 0;
  let texH = 0;
  let lutTex: GPUTexture;
  let bindGroup: GPUBindGroup | null = null;
  let warp: Mat3 | null = null;

  const makeLUTTex = (lut: LUT3D) => {
    lutTex?.destroy();
    lutTex = device.createTexture({ size: [lut.size, lut.size, lut.size], dimension: "3d", format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: lutTex }, lutToRGBA8(lut), { bytesPerRow: lut.size * 4, rowsPerImage: lut.size }, [lut.size, lut.size, lut.size]);
  };
  makeLUTTex(IDENTITY_LUT);

  const recreateBindGroup = () => {
    if (!tex) return;
    bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: tex.createView() },
        { binding: 2, resource: { buffer: uni } },
        { binding: 3, resource: lutTex.createView({ dimension: "3d" }) },
      ],
    });
  };

  const ensureTex = (w: number, h: number) => {
    if (tex && texW === w && texH === h) return;
    tex?.destroy();
    tex = device.createTexture({ size: [w, h], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    texW = w;
    texH = h;
    recreateBindGroup();
    if (opts.fitSource && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w;
      canvas.height = h;
    }
  };

  const writeParams = (p: GradeParams) => {
    const u = new Float32Array(24);
    u[0] = p.temperature ?? 0;
    u[1] = p.tint ?? 0;
    u[2] = p.exposure ?? 0;
    u[3] = p.contrast ?? 0;
    u[4] = p.highlights ?? 0;
    u[5] = p.shadows ?? 0;
    u[6] = p.saturation ?? 1;
    u[7] = p.vignette ?? 0;
    u[8] = p.lutIntensity ?? 0;
    u[9] = warp ? 1 : 0;
    u[10] = p.bloom ?? 0;
    u[11] = p.bloomThreshold ?? 0.6;
    if (warp) {
      u[12] = warp[0]; u[13] = warp[1]; u[14] = warp[2];
      u[16] = warp[3]; u[17] = warp[4]; u[18] = warp[5];
      u[20] = warp[6]; u[21] = warp[7]; u[22] = warp[8];
    }
    device.queue.writeBuffer(uni, 0, u);
  };

  const upload = (source: GradeSource) => {
    const [w, h] = sourceSize(source);
    ensureTex(w, h);
    device.queue.copyExternalImageToTexture({ source: source as GPUCopyExternalImageSource, flipY: false }, { texture: tex! }, [w, h]);
  };

  const drawTo = (view: GPUTextureView, encoder: GPUCommandEncoder) => {
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }] });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup!);
    pass.draw(3);
    pass.end();
  };

  async function render(source: GradeSource, params: GradeParams): Promise<void> {
    upload(source);
    writeParams(params);
    const encoder = device.createCommandEncoder();
    drawTo(ctx!.getCurrentTexture().createView(), encoder);
    device.queue.submit([encoder.finish()]);
    await Promise.race([device.queue.onSubmittedWorkDone(), lost]);
  }

  const align = 256;
  let readback: GPUBuffer | null = null;
  let readbackW = 0;
  let readbackH = 0;
  let bytesPerRow = 0;
  const ensureReadback = (w: number, h: number) => {
    if (readback && readbackW === w && readbackH === h) return;
    readback?.destroy();
    bytesPerRow = Math.ceil((w * 4) / align) * align;
    readback = device.createBuffer({ size: bytesPerRow * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    readbackW = w;
    readbackH = h;
  };
  const swap = format === "bgra8unorm";

  const lost: Promise<never> = device.lost.then((info) => {
    throw new Error(`WebGPU device lost (${info.reason}): ${info.message}`);
  });
  lost.catch(() => {});

  async function capture(source: GradeSource, params: GradeParams): Promise<HTMLCanvasElement> {
    upload(source);
    writeParams(params);
    const outW = canvas.width;
    const outH = canvas.height;
    ensureReadback(outW, outH);
    const encoder = device.createCommandEncoder();
    const t = ctx!.getCurrentTexture();
    drawTo(t.createView(), encoder);
    encoder.copyTextureToBuffer({ texture: t }, { buffer: readback!, bytesPerRow, rowsPerImage: outH }, [outW, outH, 1]);
    device.queue.submit([encoder.finish()]);
    await Promise.race([device.queue.onSubmittedWorkDone(), lost]);
    await Promise.race([readback!.mapAsync(GPUMapMode.READ), lost]);
    const mapped = new Uint8Array(readback!.getMappedRange());
    const out = new Uint8ClampedArray(outW * outH * 4);
    for (let y = 0; y < outH; y++) {
      const row = y * bytesPerRow;
      for (let x = 0; x < outW; x++) {
        const s = row + x * 4;
        const d = (y * outW + x) * 4;
        if (swap) { out[d] = mapped[s + 2]; out[d + 1] = mapped[s + 1]; out[d + 2] = mapped[s]; }
        else { out[d] = mapped[s]; out[d + 1] = mapped[s + 1]; out[d + 2] = mapped[s + 2]; }
        out[d + 3] = mapped[s + 3];
      }
    }
    readback!.unmap();
    const cnv = document.createElement("canvas");
    cnv.width = outW;
    cnv.height = outH;
    cnv.getContext("2d")!.putImageData(new ImageData(out, outW, outH), 0, 0);
    return cnv;
  }

  return {
    render,
    capture,
    setLUT: (lut) => { makeLUTTex(lut ?? IDENTITY_LUT); recreateBindGroup(); },
    setWarp: (h) => { warp = h; },
    destroy: () => { tex?.destroy(); lutTex?.destroy(); readback?.destroy(); try { device.destroy(); } catch { /* ignore */ } },
  };
}
