import { describe, expect, it } from "vitest";
import { kineticClothComposition } from "./KineticCloth";

describe("kinetic cloth showcase composition", () => {
  it("declares a renderable, frame-authored composition boundary", () => {
    expect(kineticClothComposition.id).toBe("KineticCloth");
    expect(kineticClothComposition.width).toBe(1280);
    expect(kineticClothComposition.height).toBe(720);
    expect(kineticClothComposition.fps).toBe(30);
    expect(kineticClothComposition.durationInFrames).toBe(240);
    expect(kineticClothComposition.setup).toBeTypeOf("function");
  });

  it("authors the cloth through the public HTML ABI", () => {
    expect(kineticClothComposition.html).toContain("data-fd-cloth");
    expect(kineticClothComposition.html).toContain('data-fd-cloth-source="#kinetic-poster"');
    expect(kineticClothComposition.html).not.toContain('data-fd-x="0"');
    expect(kineticClothComposition.document).toMatchObject({ cloth: { x: 0, width: 1280, pins: "corners" } });
    expect(kineticClothComposition.meta?.document).toMatchObject({
      file: "src/compositions/KineticCloth.comp.json",
      bindings: { "cloth-surface": "/cloth" },
    });
    expect(kineticClothComposition.meta?.deps).toContain("src/effects/kineticPosterCloth.ts");
  });
});
