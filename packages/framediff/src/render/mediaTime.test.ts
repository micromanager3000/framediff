import { describe, expect, it } from "vitest";
import { clampVisualMediaTime } from "./mediaTime";

describe("clampVisualMediaTime", () => {
  it("holds the first frame before a visual source begins", () => {
    expect(clampVisualMediaTime(-2, 5)).toBe(0);
  });

  it("holds the last decodable frame after a visual source ends", () => {
    expect(clampVisualMediaTime(9, 5)).toBeCloseTo(5 - 1e-6, 12);
  });

  it("leaves in-range and not-yet-known durations usable", () => {
    expect(clampVisualMediaTime(2.5, 5)).toBe(2.5);
    expect(clampVisualMediaTime(2.5, Number.NaN)).toBe(2.5);
  });
});
