import type { GradeParams, LUT3D } from "framediff";
import { lutFor, lutsReady } from "./luts";

// Fallback when fitted LUTs are not present: a hand-tuned Lumetri-ish look.
export const HERO_FALLBACK_GRADE: GradeParams = {
  temperature: 0.14,
  tint: 0.05,
  exposure: 0.03,
  contrast: 0.06,
  highlights: -0.06,
  shadows: 0,
  saturation: 1.05,
  vignette: 0.34,
  bloom: 0.35,
  bloomThreshold: 0.55,
};

// Fitted-LUT shots get NO procedural extras: the LUTs are fitted proxy→reference directly,
// so they already carry the complete transform — anything layered on top is an unvalidated
// deviation. Measured on the newsroom segment (ratio heatmap vs the reference, 2026-07-07):
// the old hand-set vignette 0.24 darkened corners the reference doesn't darken, and bloom
// 0.22 fired on the bright rec709 sources (+10-15% mid-frame wash-out; it was inert on the
// flat FX3 opener, which is why the opener never showed it).
export const HERO_LUT_SPATIAL_GRADE: GradeParams = {};

const HERO_SHOT_LUT_GRADES: Record<string, GradeParams> = {};

// Per-shot residual corrections now live INSIDE the per-shot cubes (open.cube/phone.cube
// carry measured output-side channel gains — see gradefit's FX3_OUTPUT_GAIN). The scalar
// exposure ramp below predates the S-Log3-headed fit and is retired; the mechanism stays
// for future shots whose reference grade genuinely ramps over time.
const HERO_SHOT_EXPOSURE_RAMP: Record<string, Array<[number, number]>> = {};

export function shotExposureAt(shotName: string, frame: number): number {
  const pts = HERO_SHOT_EXPOSURE_RAMP[shotName];
  if (!pts?.length) return 0;
  if (frame <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [f0, v0] = pts[i];
    const [f1, v1] = pts[i + 1];
    if (frame <= f1) return v0 + ((v1 - v0) * (frame - f0)) / Math.max(1e-6, f1 - f0);
  }
  return pts[pts.length - 1][1];
}

export interface HeroShotLook {
  grade: GradeParams;
  lut?: LUT3D;
  lutIntensity: number;
}

/** AEP-derived shot names → the segment the LUT was fitted under (fitted names predate the
 *  AEP-exact EDL: tripod_a/b are the two tripod cuts, keynote_N the stacked keynote panes…). */
const LUT_ALIASES: Record<string, string> = {
  tripod_a: "tripod",
  tripod_b: "tripod",
  greentrack: "greenwide",
  grid_0: "grid",
  grid_1: "grid",
  keynote_0: "keynote_a",
  keynote_1: "keynote_a",
  keynote_2: "keynote_a",
  split_0: "split_l",
  split_1: "split_r",
};

export function heroShotLook(shotName: string): HeroShotLook {
  const lut = lutsReady() ? lutFor(LUT_ALIASES[shotName] ?? shotName) : undefined;
  return {
    grade: lut ? HERO_SHOT_LUT_GRADES[shotName] ?? HERO_LUT_SPATIAL_GRADE : HERO_FALLBACK_GRADE,
    lut,
    lutIntensity: lut ? 1 : 0,
  };
}
