import { describe, it, expect } from "vitest";
import { canonicalJSON } from "./canonicalJSON";

describe("canonicalJSON", () => {
  it("is key-order independent", () => {
    expect(canonicalJSON({ a: 1, b: 2 })).toBe(canonicalJSON({ b: 2, a: 1 }));
  });
  it("recurses into nested objects and arrays", () => {
    expect(canonicalJSON({ x: { c: 1, a: 2 }, y: [3, { z: 1, y: 2 }] })).toBe(
      canonicalJSON({ y: [3, { y: 2, z: 1 }], x: { a: 2, c: 1 } }),
    );
  });
  it("preserves array order (arrays are positional)", () => {
    expect(canonicalJSON([1, 2, 3])).not.toBe(canonicalJSON([3, 2, 1]));
  });
  it("drops undefined keys rather than serializing null", () => {
    expect(canonicalJSON({ a: 1, b: undefined })).toBe(canonicalJSON({ a: 1 }));
    expect(canonicalJSON({ a: 1, b: undefined })).not.toBe(canonicalJSON({ a: 1, b: null }));
  });
  it("throws on non-finite numbers and unserializable values", () => {
    expect(() => canonicalJSON({ a: NaN })).toThrow();
    expect(() => canonicalJSON({ a: Infinity })).toThrow();
    expect(() => canonicalJSON({ f: () => 1 })).toThrow();
  });
});
