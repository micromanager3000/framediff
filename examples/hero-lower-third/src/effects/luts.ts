// The fitted grade: 3D LUTs recovered numerically from (raw frame, reference frame) pairs —
// the AEP's SL GOLD RUSH LUT isn't on disk, so the color transform was fitted per shot group
// (see public/luts/manifest.json + the gradefit report). Preloaded before mount so exports
// bake deterministically from frame 0.

import { parseCubeLUT, type LUT3D } from "framediff";

const bySegment = new Map<string, LUT3D>();

export async function preloadLuts(): Promise<void> {
  try {
    const manifest = (await (await fetch("/luts/manifest.json")).json()) as {
      segments: Record<string, string>;
    };
    const files = [...new Set(Object.values(manifest.segments))];
    const parsed = new Map<string, LUT3D>();
    await Promise.all(
      files.map(async (f) => {
        const text = await (await fetch(`/luts/${f}`)).text();
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
