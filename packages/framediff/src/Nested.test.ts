// The pure frame remap behind <Nested>: parent-local frames → child frames, honoring the child
// in-point (trimStart, seconds) and clamping to the child's duration (over-long windows freeze).

import { describe, expect, it } from "vitest";
import { mapNestedFrame } from "./nested";

describe("mapNestedFrame", () => {
  const child = { fps: 30, durationInFrames: 300 }; // 10s child

  it("identity when fps match and no trim", () => {
    expect(mapNestedFrame(0, 30, child)).toBe(0);
    expect(mapNestedFrame(42, 30, child)).toBe(42);
  });

  it("trimStart slips the child in-point (seconds — same unit as <Video trimStart>)", () => {
    // parent frame 0 with trimStart 2s → child frame 60
    expect(mapNestedFrame(0, 30, child, 2)).toBe(60);
    expect(mapNestedFrame(30, 30, child, 2)).toBe(90);
  });

  it("fps remap: 24fps parent driving a 30fps child advances 1.25 child frames per parent frame", () => {
    expect(mapNestedFrame(24, 24, child)).toBeCloseTo(30, 9);
    expect(mapNestedFrame(1, 24, child)).toBeCloseTo(1.25, 9);
  });

  it("clamps to the child's last frame (freeze, not overflow)", () => {
    expect(mapNestedFrame(1000, 30, child)).toBeLessThan(300);
    expect(mapNestedFrame(1000, 30, child)).toBeCloseTo(300, 3);
    expect(mapNestedFrame(-5, 30, child)).toBe(0);
  });

  it("trim + window: a 24s parent window starting at child second 8 covers 8→32 of the child", () => {
    const c = { fps: 24, durationInFrames: 24 * 40 };
    expect(mapNestedFrame(0, 24, c, 8)).toBe(8 * 24);
    expect(mapNestedFrame(24 * 24 - 1, 24, c, 8)).toBe(32 * 24 - 1);
  });
});
