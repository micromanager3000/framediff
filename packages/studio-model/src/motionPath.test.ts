import { describe, expect, it } from "vitest";
import { fitGesturePath, makeArcSegment, motionPathToSvg, parseMotionPathSvg, pointOnCubic, sampleGestureByFrame, simplifyGesture } from "./motionPath";

describe("frame-native motion paths", () => {
  it("creates reversible cubic arc source", () => {
    const segment = makeArcSegment({ x: 0, y: 0 }, { x: 120, y: 40 }, 0.3, "clockwise");
    const source = motionPathToSvg([segment]);
    expect(parseMotionPathSvg(source)).toEqual([segment]);
    expect(pointOnCubic(segment, 0)).toEqual({ x: 0, y: 0 });
    expect(pointOnCubic(segment, 1)).toEqual({ x: 120, y: 40 });
    expect(pointOnCubic(segment, 0.5).y).toBeGreaterThan(20);
  });

  it("keeps at most one final pointer sample per composition frame", () => {
    expect(sampleGestureByFrame([
      { frame: 2.1, x: 0, y: 0 },
      { frame: 2.4, x: 4, y: 3 },
      { frame: 3.1, x: 10, y: 5 },
    ])).toEqual([
      { frame: 2, x: 4, y: 3 },
      { frame: 3, x: 10, y: 5 },
    ]);
  });

  it("filters jitter and fits the same cubic path regardless of extra same-frame events", () => {
    const core = [
      { frame: 0, x: 0, y: 0 },
      { frame: 1, x: 20, y: 12 },
      { frame: 2, x: 40, y: 26 },
      { frame: 3, x: 60, y: 40 },
    ];
    const noisy = [core[0], { frame: 1, x: 18, y: 11 }, core[1], { frame: 2, x: 39, y: 25 }, core[2], core[3]];
    expect(motionPathToSvg(fitGesturePath(noisy, 3))).toBe(motionPathToSvg(fitGesturePath(core, 3)));
    expect(simplifyGesture(core, 3).length).toBeLessThanOrEqual(core.length);
  });
});
