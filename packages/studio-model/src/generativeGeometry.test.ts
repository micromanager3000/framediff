import { describe, expect, it } from "vitest";
import {
  classifyVisualGeometry,
  cropRegionMatchesTargetAspect,
  cropRegionForTargetAspect,
  normalizeCropRegion,
  retargetCropRegion,
} from "./generativeGeometry";

describe("classifyVisualGeometry", () => {
  it.each([
    [1920, 1080, 1920, 1080, "exact", ["native"]],
    [1280, 720, 1920, 1080, "larger-both", ["resize"]],
    [3840, 2160, 1920, 1080, "smaller-both", ["resize"]],
    [1280, 1080, 1920, 1080, "larger-width", ["cover", "contain", "stretch"]],
    [1920, 720, 1920, 1080, "larger-height", ["cover", "contain", "stretch"]],
    [2560, 1080, 1920, 1080, "smaller-width", ["cover", "contain", "stretch"]],
    [1920, 1440, 1920, 1080, "smaller-height", ["cover", "contain", "stretch"]],
    [1080, 1920, 1920, 1080, "mixed", ["cover", "contain", "stretch"]],
  ] as const)(
    "classifies %sx%s → %sx%s as %s",
    (sourceWidth, sourceHeight, targetWidth, targetHeight, relation, allowedFits) => {
      const result = classifyVisualGeometry(sourceWidth, sourceHeight, targetWidth, targetHeight);
      expect(result.relation).toBe(relation);
      expect(result.allowedFits).toEqual(allowedFits);
    },
  );
});

describe("crop regions", () => {
  it("locks a landscape crop to a portrait target aspect", () => {
    const crop = cropRegionForTargetAspect(1920, 1080, 1080, 1920);
    const croppedAspect = (1920 * crop.width) / (1080 * crop.height);
    expect(croppedAspect).toBeCloseTo(1080 / 1920);
    expect(crop.x).toBeGreaterThan(0);
    expect(crop.height).toBe(1);
    expect(cropRegionMatchesTargetAspect(crop, 1920, 1080, 1080, 1920)).toBe(true);
    expect(cropRegionMatchesTargetAspect({ ...crop, width: crop.width * 0.5 }, 1920, 1080, 1080, 1920)).toBe(false);
  });

  it("keeps a dragged crop inside normalized source bounds", () => {
    expect(normalizeCropRegion({ x: 0.9, y: -0.4, width: 0.4, height: 0.6 })).toEqual({
      x: 0.6,
      y: 0,
      width: 0.4,
      height: 0.6,
    });
  });

  it("preserves crop focus while retargeting to a different model shape", () => {
    const original = cropRegionForTargetAspect(1920, 1080, 1080, 1920, 0.65, 0.5, 0.7);
    const retargeted = retargetCropRegion(
      original,
      1920,
      1080,
      1080,
      1920,
      1024,
      1024,
      1080,
      1920,
    );
    expect(cropRegionMatchesTargetAspect(retargeted, 1024, 1024, 1080, 1920)).toBe(true);
    expect(retargeted.x + retargeted.width / 2).toBeCloseTo(0.65, 2);
  });
});
