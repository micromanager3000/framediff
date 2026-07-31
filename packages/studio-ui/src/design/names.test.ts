import { describe, expect, it } from "vitest";
import { splitVariantName } from "./names";

describe("splitVariantName", () => {
  it("protects the variant suffix that end-truncation used to destroy", () => {
    const names = ["HeroPlane3D.june3d", "HeroPlane3D.wide", "HeroPlane3D.closeup", "HeroPlane3D.top"];
    const split = names.map(splitVariantName);
    // Every stem is identical — which is exactly why truncating the stem is safe and truncating
    // the suffix is not.
    expect(new Set(split.map((entry) => entry.stem))).toEqual(new Set(["HeroPlane3D"]));
    expect(split.map((entry) => entry.suffix)).toEqual([".june3d", ".wide", ".closeup", ".top"]);
  });

  it("leaves a name with no suffix whole", () => {
    expect(splitVariantName("AuthoringChapter")).toEqual({ stem: "AuthoringChapter", suffix: "" });
    expect(splitVariantName("HeroRaw")).toEqual({ stem: "HeroRaw", suffix: "" });
  });

  it("ignores dots that are not variant suffixes", () => {
    // A leading dot is not a suffix.
    expect(splitVariantName(".hidden")).toEqual({ stem: ".hidden", suffix: "" });
    // A trailing dot has nothing after it.
    expect(splitVariantName("Trailing.")).toEqual({ stem: "Trailing.", suffix: "" });
    // A long tail is a name, not a variant — pinning it would defeat the truncation entirely.
    expect(splitVariantName("A.reallyLongTailSegment")).toEqual({ stem: "A.reallyLongTailSegment", suffix: "" });
  });

  it("splits at the last dot when a name has several", () => {
    expect(splitVariantName("Hero.plane.v2")).toEqual({ stem: "Hero.plane", suffix: ".v2" });
  });

  it("always reassembles to the original name", () => {
    for (const name of ["HeroPlane3D.june3d", "AuthoringChapter", ".hidden", "Hero.plane.v2", "Trailing."]) {
      const { stem, suffix } = splitVariantName(name);
      expect(stem + suffix).toBe(name);
    }
  });
});
