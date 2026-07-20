import { describe, it, expect } from "vitest";
import { squareToQuad, invert3x3, applyMat3, cornerPinInverse, type Mat3 } from "./homography";

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const dst: [number, number][] = [[0.2, 0.1], [0.9, 0.2], [0.8, 0.85], [0.1, 0.7]];
const corners: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];

describe("homography", () => {
  it("identity corners → identity map", () => {
    expect(squareToQuad(corners)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("square→quad maps the unit-square corners onto the destination corners", () => {
    const H = squareToQuad(dst);
    corners.forEach((p, k) => {
      const [x, y] = applyMat3(H, p[0], p[1]);
      expect(close(x, dst[k][0]) && close(y, dst[k][1])).toBe(true);
    });
  });

  it("inverse round-trips: a screen (dest) corner maps back to its source corner", () => {
    const Hinv = cornerPinInverse(dst);
    dst.forEach((p, k) => {
      const [u, v] = applyMat3(Hinv, p[0], p[1]);
      expect(close(u, corners[k][0]) && close(v, corners[k][1])).toBe(true);
    });
  });

  it("invert3x3(identity) = identity", () => {
    const inv = invert3x3([1, 0, 0, 0, 1, 0, 0, 0, 1]).map((x) => x + 0) as Mat3;
    expect(inv).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("throws on degenerate corners", () => {
    expect(() => cornerPinInverse([[0, 0], [0, 0], [0, 0], [0, 0]])).toThrow();
  });
});
