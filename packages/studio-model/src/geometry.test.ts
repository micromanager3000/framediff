import { describe, expect, it } from "vitest";
import {
  applyAffine,
  composeAffine,
  invertAffine,
  previewDeltaToComposition,
  resizeRect,
} from "./geometry";

describe("preview geometry contract", () => {
  it("round-trips composition points through a scaled and rotated preview", () => {
    const matrix = composeAffine({ translate: { x: 340, y: 90 }, scale: { x: 0.5, y: 0.5 }, rotateDegrees: 27 });
    const point = { x: 413.25, y: 207.75 };
    const roundTrip = applyAffine(invertAffine(matrix), applyAffine(matrix, point));
    expect(roundTrip.x).toBeCloseTo(point.x, 10);
    expect(roundTrip.y).toBeCloseTo(point.y, 10);
  });

  it("maps a rotated preview drag back to exact composition axes", () => {
    const matrix = composeAffine({ scale: { x: 0.4, y: 0.4 }, rotateDegrees: 90 });
    const delta = previewDeltaToComposition(matrix, { x: -8, y: 20 });
    expect(delta.x).toBeCloseTo(50);
    expect(delta.y).toBeCloseTo(20);
  });

  it("keeps the opposite resize corner fixed and enforces aspect and minimums", () => {
    expect(resizeRect({ x: 10, y: 20, width: 160, height: 90 }, "nw", { x: 40, y: 10 }, { lockAspect: true }))
      .toEqual({ x: 50, y: 42.5, width: 120, height: 67.5 });
    expect(resizeRect({ x: 10, y: 20, width: 20, height: 20 }, "nw", { x: 100, y: 100 }, { minWidth: 8, minHeight: 6 }))
      .toEqual({ x: 22, y: 34, width: 8, height: 6 });
  });
});
