// Parity with Remotion's spring(): golden values generated from remotion@lt-marketing
// (node: require remotion/dist/cjs/spring) at fps = 24000/1001 — the exact configs the
// hero-with-lower-third overlays use. A port drift here would de-sync the motion.

import { describe, expect, it } from "vitest";
import { springR, measureSpringR } from "./springRemotion";

const FPS = 24000 / 1001;

const GOLDEN: Record<string, { opts: Parameters<typeof springR>[0] extends infer T ? Partial<T> : never; values: [number, number][] }> = {
  "lower-third enter (damping 200, mass .7, dur .6s)": {
    opts: { config: { damping: 200, mass: 0.7 }, durationInFrames: Math.round(FPS * 0.6) },
    values: [
      [0, 0],
      [3, 0.4758289320819524],
      [7, 0.8873010737805804],
      [10, 0.9672452915030257],
      [14, 0.9952051642125984],
      [16, 1],
    ],
  },
  "lower-third underline (damping 13, mass .5, delay 3, dur .5s)": {
    opts: { config: { damping: 13, mass: 0.5 }, delay: Math.round(FPS * 0.12), durationInFrames: Math.round(FPS * 0.5) },
    values: [
      [0, 0],
      [3, 0],
      [6, 0.45425973529220787],
      [9, 0.8311744330549312],
      [12, 0.9634857368951125],
      [15, 0.9954784828260892],
      [20, 1],
    ],
  },
  "end-card line1 (damping 200, dur .7s)": {
    opts: { config: { damping: 200 }, durationInFrames: Math.round(FPS * 0.7) },
    values: [
      [0, 0],
      [5, 0.6473971904304838],
      [10, 0.9333639211839408],
      [17, 0.9953297929523882],
      [25, 1],
    ],
  },
  "end-card underline (damping 14, mass .6, dur .6s)": {
    opts: { config: { damping: 14, mass: 0.6 }, durationInFrames: Math.round(FPS * 0.6) },
    values: [
      [0, 0],
      [4, 0.534618125998885],
      [8, 0.895938064907625],
      [12, 0.9880832755026329],
      [18, 1],
      [30, 1],
    ],
  },
  "plain default config (overshoots)": {
    opts: {},
    values: [
      [0, 0],
      [2, 0.2540798582425703],
      [5, 0.8842441455085773],
      [10, 1.1432751419505278],
      [20, 0.9837020811175188],
      [40, 0.9999419280446727],
    ],
  },
};

describe("springR — Remotion parity", () => {
  for (const [name, g] of Object.entries(GOLDEN)) {
    it(name, () => {
      for (const [frame, expected] of g.values) {
        expect(springR({ frame, fps: FPS, ...(g.opts as object) })).toBeCloseTo(expected, 9);
      }
    });
  }

  it("from/to remap", () => {
    const v = springR({ frame: 10, fps: FPS, from: 5, to: 9 });
    const base = springR({ frame: 10, fps: FPS });
    expect(v).toBeCloseTo(5 + 4 * base, 9);
  });

  it("measureSpringR is finite and positive for the default config", () => {
    const d = measureSpringR({ fps: FPS });
    expect(d).toBeGreaterThan(0);
    expect(Number.isFinite(d)).toBe(true);
  });
});
