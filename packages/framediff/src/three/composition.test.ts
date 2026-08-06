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
      dataFile: "src/HarborPreviz.scene.json",
      data: { version: 1, cameras: [{ camera: "wide", from: 0, durationInFrames: 90, name: "Opening wide" }] },
    });

    expect(composition.definition).toEqual({ version: 2, type: "three", kind: "scene", dataMode: "json" });
    expect(composition.meta).toMatchObject({ library: true, sourceFormat: "generated" });
    expect(composition.html).toContain('data-fd-camera="wide"');
    expect(composition.html).toContain('data-fd-name="Opening wide"');
    expect(composition.html).toContain('data-fd-duration="90"');
    expect(composition.setup).toBeTypeOf("function");
  });

  it("keeps an explicitly referenced Set composition as a first-class input", () => {
    const scene = defineThreeScene({ id: "pizza-world", create: () => undefined, cameras: { counter: {} } });
    const set = defineThreeSceneComposition({
      scene,
      id: "Set",
      width: 1280,
      height: 720,
      fps: 30,
      durationInFrames: 240,
      dataFile: "src/Set.scene.json",
      data: { version: 1, defaultCamera: "counter" },
      meta: { file: "src/Set.ts" },
    });
    const shot = defineThreeSceneComposition({
      scene: set,
      id: "PrevizCountertalk",
      width: 1280,
      height: 720,
      fps: 30,
      durationInFrames: 120,
      dataFile: "src/PrevizCountertalk.scene.json",
      data: { version: 1, defaultCamera: "counter" },
      cameraFile: "src/PrevizCountertalk.cameras.json",
      meta: { file: "src/PrevizCountertalk.ts" },
    });

    expect(shot.threeScene).toBe(scene);
    expect(shot.threeSceneSourceCompId).toBe("Set");
    expect(shot.html).toContain('data-fd-scene-comp="Set"');
    expect(shot.html).toContain('data-fd-camera-file="src/PrevizCountertalk.cameras.json"');
    expect(shot.meta?.deps).toEqual(expect.arrayContaining(["src/Set.ts", "src/PrevizCountertalk.scene.json", "src/PrevizCountertalk.cameras.json"]));
  });
});
