import type { CompositionConfig } from "./composition";
import { hashBytes, type Hash } from "./graph/hash";
import { renderFrameToCanvas } from "./render/renderFrame";

export interface DeterminismFrameResult {
  frame: number;
  hashes: Hash[];
  stable: boolean;
  /** Optional first render, useful for visual test reports. */
  thumbnailDataUrl?: string;
}

export interface CheckCompositionDeterminismOptions {
  frames: number[];
  width?: number;
  /** Number of independent renders per frame. Defaults to two. */
  repetitions?: number;
  thumbnails?: boolean;
}

async function hashCanvas(canvas: HTMLCanvasElement): Promise<Hash> {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not read a rendered composition frame.");
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  return hashBytes(pixels);
}

/** Render selected frames repeatedly and compare their pre-encode RGBA pixels. */
export async function checkCompositionDeterminism(
  composition: CompositionConfig,
  options: CheckCompositionDeterminismOptions,
): Promise<DeterminismFrameResult[]> {
  const repetitions = Math.max(2, Math.floor(options.repetitions ?? 2));
  const results: DeterminismFrameResult[] = [];
  for (const frame of options.frames) {
    const hashes: Hash[] = [];
    let thumbnailDataUrl: string | undefined;
    for (let run = 0; run < repetitions; run += 1) {
      const canvas = await renderFrameToCanvas(composition, frame, {
        width: options.width,
      });
      hashes.push(await hashCanvas(canvas));
      if (run === 0 && options.thumbnails) thumbnailDataUrl = canvas.toDataURL("image/png");
    }
    results.push({
      frame,
      hashes,
      stable: hashes.every((hash) => hash === hashes[0]),
      thumbnailDataUrl,
    });
  }
  return results;
}
