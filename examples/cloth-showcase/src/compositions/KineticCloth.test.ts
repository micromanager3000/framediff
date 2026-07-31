import { describe, expect, it } from "vitest";
import { kineticClothComposition } from "./KineticCloth";
import { materialPosterComposition } from "./MaterialPoster";

describe("kinetic cloth showcase composition", () => {
  it("declares a renderable, frame-authored composition boundary", () => {
    expect(kineticClothComposition.id).toBe("KineticCloth");
    expect(kineticClothComposition.width).toBe(1280);
    expect(kineticClothComposition.height).toBe(720);
    expect(kineticClothComposition.fps).toBe(30);
    expect(kineticClothComposition.durationInFrames).toBe(240);
    expect(kineticClothComposition.setup).toBeTypeOf("function");
  });

  it("uses a nested composition as the public cloth texture input", () => {
    expect(kineticClothComposition.html).toContain("data-fd-cloth");
    expect(kineticClothComposition.html).toContain('data-fd-cloth-source="#fd-cloth-input"');
    expect(kineticClothComposition.html).toContain('data-fd-comp="material-poster"');
    expect(kineticClothComposition.html).toContain('href="https://holocloth.vercel.app"');
    expect(kineticClothComposition.html).not.toContain('data-fd-x="0"');
    expect(kineticClothComposition.document).toMatchObject({ cloth: { x: 0, width: 1280, pins: "corners" } });
    expect(kineticClothComposition.meta?.document).toMatchObject({
      file: "src/compositions/KineticCloth.comp.json",
      bindings: { "cloth-surface": "/cloth" },
    });
    expect(kineticClothComposition.meta?.deps).toContain("src/effects/kineticPosterCloth.ts");
  });

  it("keeps the texture source as an independently authorable composition", () => {
    expect(materialPosterComposition).toMatchObject({
      id: "MaterialPoster",
      width: 944,
      height: 560,
      fps: 30,
      durationInFrames: 240,
    });
    expect(materialPosterComposition.html).toContain("Composition input / 001");
    expect(materialPosterComposition.html).not.toContain("data-fd-cloth");
  });
});
