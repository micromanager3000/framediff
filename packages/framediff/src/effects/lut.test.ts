import { describe, it, expect } from "vitest";
import { parseCubeLUT, generateWarmGoldLUT, lutToRGBA8 } from "./lut";

const identity2 = `LUT_3D_SIZE 2
# an identity 2x2x2 cube
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1`;

describe("LUT", () => {
  it("parses a .cube (size, length, R-fastest ordering)", () => {
    const lut = parseCubeLUT(identity2);
    expect(lut.size).toBe(2);
    expect(lut.data.length).toBe(24);
    expect([...lut.data.slice(0, 3)]).toEqual([0, 0, 0]);
    expect([...lut.data.slice(3, 6)]).toEqual([1, 0, 0]); // r varies fastest
    expect([...lut.data.slice(-3)]).toEqual([1, 1, 1]);
  });

  it("throws on a malformed .cube (wrong entry count)", () => {
    expect(() => parseCubeLUT("LUT_3D_SIZE 2\n0 0 0")).toThrow();
  });

  it("generates a warm-gold LUT of the right size, in range", () => {
    const lut = generateWarmGoldLUT(9);
    expect(lut.size).toBe(9);
    expect(lut.data.length).toBe(9 * 9 * 9 * 3);
    expect(Math.min(...lut.data)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...lut.data)).toBeLessThanOrEqual(1);
  });

  it("packs to RGBA8 with opaque alpha", () => {
    const rgba = lutToRGBA8(generateWarmGoldLUT(5));
    expect(rgba.length).toBe(5 * 5 * 5 * 4);
    expect(rgba[3]).toBe(255);
  });

  it("is deterministic", () => {
    expect([...generateWarmGoldLUT(5).data]).toEqual([...generateWarmGoldLUT(5).data]);
  });
});
