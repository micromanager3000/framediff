import { describe, it, expect } from "vitest";
import { resolveBakeResolution } from "./mediaBundle";

describe("resolveBakeResolution (deterministic, pixel-independent)", () => {
  it("native = the comp's own size", () => {
    expect(resolveBakeResolution("native", { w: 1920, h: 1080 }, { w: 3840, h: 2160 })).toEqual({ w: 1920, h: 1080 });
  });
  it("target = the render target, quantized", () => {
    expect(resolveBakeResolution("target", { w: 1920, h: 1080 }, { w: 1280, h: 720 })).toEqual({ w: 1280, h: 720 });
  });
  it("auto caps at native (never upscales)", () => {
    const r = resolveBakeResolution("auto", { w: 1280, h: 720 }, { w: 3840, h: 2160 });
    expect(r.w).toBeLessThanOrEqual(1280);
  });
  it("explicit {w,h} passes through", () => {
    expect(resolveBakeResolution({ w: 512, h: 512 }, { w: 1, h: 1 }, { w: 1, h: 1 })).toEqual({ w: 512, h: 512 });
  });
  it("is a pure function of declared sizes", () => {
    const a = resolveBakeResolution("auto", { w: 1920, h: 1080 }, { w: 3840, h: 2160 });
    const b = resolveBakeResolution("auto", { w: 1920, h: 1080 }, { w: 3840, h: 2160 });
    expect(a).toEqual(b);
  });
});
