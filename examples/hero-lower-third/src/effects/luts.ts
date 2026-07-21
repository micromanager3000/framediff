// The fitted grade: 3D LUTs recovered numerically from (raw frame, reference frame) pairs —
// the AEP's SL GOLD RUSH LUT isn't on disk, so the color transform was fitted per shot group
// (see public/luts/manifest.json + the gradefit report). The LUT bytes live in the Git LFS asset
// store and are preloaded before mount so exports
// bake deterministically from frame 0.

import { parseCubeLUT, type LUT3D } from "framediff";

const bySegment = new Map<string, LUT3D>();

const LUT_SOURCES: Record<string, string> = {
  "fx3.cube": "/__framediff-cache/sha256%3Abf4ad296c1335d2661e5d0d55f1312e05e858ab18adc88d8d421253d3adbad2b",
  "global.cube": "/__framediff-cache/sha256%3A508bb3f83ed37cf1dbba324f7c3d1983b798fe82d295a44ad9ef20706639cd9c",
  "grid.cube": "/__framediff-cache/sha256%3Ab018d3869c74dd6a1e28caec1e7047b11b36c6f47105cc995d167df815914259",
  "hf_talk.cube": "/__framediff-cache/sha256%3Ae44b52965b17b613634766d380ff22a3cb1f1b275d124b6b14352a2f619c32d9",
  "keynote_b.cube": "/__framediff-cache/sha256%3A6f6ba56915e90a1b921656292c21d84df79970770feb69fb4212de571016b467",
  "open.cube": "/__framediff-cache/sha256%3A0abeb69d97fcfb29ac4ef8d8efaf40628c84ed0b332dc438ba29ccccd7fc5bc2",
  "phone.cube": "/__framediff-cache/sha256%3A8defddd0ee68a5438f7d16d71c28c4bccd51db980ce5ad855050cfb06346de7b",
};

export async function preloadLuts(): Promise<void> {
  try {
    const manifest = (await (await fetch("/luts/manifest.json")).json()) as {
      segments: Record<string, string>;
    };
    const files = [...new Set(Object.values(manifest.segments))];
    const parsed = new Map<string, LUT3D>();
    await Promise.all(
      files.map(async (f) => {
        const source = LUT_SOURCES[f];
        if (!source) throw new Error(`Missing asset source for LUT ${f}`);
        const text = await (await fetch(source)).text();
        parsed.set(f, parseCubeLUT(text));
      }),
    );
    for (const [seg, f] of Object.entries(manifest.segments)) {
      const lut = parsed.get(f);
      if (lut) bySegment.set(seg, lut);
    }
    const g = parsed.get("global.cube");
    if (g) bySegment.set("__global__", g); // fallback for shots without their own fit
  } catch {
    // no LUTs (fresh checkout before gradefit ran) — shots render with the fallback grade
  }
}

/** The fitted LUT for a shot, or undefined → caller falls back to a parametric grade. */
export function lutFor(segment: string): LUT3D | undefined {
  return bySegment.get(segment) ?? bySegment.get("__global__") ?? undefined;
}

/** True once any LUT is loaded (used to pick lut vs fallback grade). */
export function lutsReady(): boolean {
  return bySegment.size > 0;
}
