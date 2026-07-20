// A precomp bakes to a MediaBundle: the video artifact, optional audio stems, color metadata, and
// timing — all referenced by content hash. The consumer (<Comp>) plays the video and re-emits the
// stems as ordinary <Audio> layers, so nested audio rides the existing offline mixer unchanged.

import type { Hash } from "../graph/hash";

export interface MediaBundle {
  video: { contentHash: Hash; url?: string; codec: string; width: number; height: number; fps: number };
  audioStems: { contentHash: Hash; url?: string; sampleRate: number; channels: number; startFrame: number; volume: number }[];
  durationInFrames: number;
  color: { workingSpace: string; transfer: string; range: "full" | "limited" };
}

export type BakeResolution = "auto" | "native" | "target" | { w: number; h: number };

const quantize = (r: { w: number; h: number }, step = 16) => ({
  w: Math.max(step, Math.ceil(r.w / step) * step),
  h: Math.max(step, Math.ceil(r.h / step) * step),
});

/**
 * Deterministic, pixel-independent bake resolution. It depends only on declared sizes (never measured
 * DOM), and quantizes to a fixed step so two machines compute byte-identical sizes (a per-machine size
 * would diverge the fingerprint and miss the cache team-wide).
 *
 * - "native": the precomp's own size.
 * - "target": the final render target, quantized.
 * - "auto" (default): the target, capped at native (no upscaling), quantized. (A future pass replaces
 *   this with footprint-from-declared-layout; until then it never bakes larger than needed or native.)
 * - {w,h}: explicit.
 */
export function resolveBakeResolution(
  spec: BakeResolution | undefined,
  native: { w: number; h: number },
  target: { w: number; h: number },
): { w: number; h: number } {
  if (typeof spec === "object") return spec;
  if (spec === "native") return native;
  if (spec === "target") return quantize(target);
  // "auto" / undefined
  const w = Math.min(target.w, native.w);
  const scale = w / target.w;
  return quantize({ w, h: Math.round(target.h * scale) });
}
