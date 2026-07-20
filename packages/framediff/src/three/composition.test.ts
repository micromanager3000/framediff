import { describe, expect, it } from "vitest";
import { defineThreeScene } from "./sceneDef";
import { defineThreeSceneComposition } from "./composition";

describe("defineThreeSceneComposition", () => {
  it("creates a generated 3D composition with timeline camera cuts", () => {
    const scene = defineThreeScene({ id: "harbor", create: () => undefined, cameras: { wide: {} } });
    const composition = defineThreeSceneComposition({
      scene,
      id: "Harbor previz",
      width: 1280,
      height: 720,
      fps: 30,
      durationInFrames: 90,
      cameras: [{ camera: "wide", from: 0, durationInFrames: 90, name: "Opening wide" }],
    });

    expect(composition.meta).toMatchObject({ kind: "3d", library: true, sourceFormat: "generated" });
    expect(composition.html).toContain('data-fd-camera="wide"');
    expect(composition.html).toContain('data-fd-name="Opening wide"');
    expect(composition.html).toContain('data-fd-duration="90"');
    expect(composition.setup).toBeTypeOf("function");
  });
});
